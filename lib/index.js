import * as github from '@actions/github';
import * as core from '@actions/core';
import { simpleGit } from 'simple-git';
import path from 'path';
import { mkdir } from 'fs/promises';

import { createBranch, clone, push, removeRemoteBranch } from './git.js';
import { getReposList, createPr, getRepoDefaultBranch, getExistingPr, getPackageJsonList } from './api-calls.js';
import { readPackageJson, parseCommaList, verifyDependencyType, installDependency, prIdentifierComment } from './utils.js';

/**
 * @description Main function that runs the action logic
 * @param {string} packageJsonPath path to package.json file of the dependency that should be bumped in other repositories
 * @param {Object} octokit authenticated octokit instance
 */
async function runForPackage(packageJsonPath, octokit) {
  packageJsonPath = path.join(packageJsonPath, 'package.json').trim();
  if (process.env.LOCAL_REPO_PATH) {
    packageJsonPath = path.join(process.env.LOCAL_REPO_PATH, packageJsonPath);
  }

  core.info(`Reading package.json from ${packageJsonPath} to identify dependency name and version that should be bumped in other repositories.`);

  const { name: dependencyName, version: dependencyVersion} = await readPackageJson(packageJsonPath);
  core.info(`Identified dependency name as ${dependencyName} with version ${dependencyVersion}. Now it will be bumped in dependent projects.`);

  const commitMessageProd = core.getInput('commit_message_prod') || `fix: update ${dependencyName} to ${dependencyVersion} version and others`;
  const commitMessageDev = core.getInput('commit_message_dev') || `chore: update ${dependencyName} to ${dependencyVersion} version and others`;
  const reposToIgnore = core.getInput('repos_to_ignore');
  const baseBranchName = core.getInput('base_branch');
  const customId = core.getInput('custom_id') || false;

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const ignoredRepositories = reposToIgnore ? parseCommaList(reposToIgnore) : [];

  // Turbo repo automatically updates package.json files in subfolders so we should ignore it
  //by default repo where workflow runs should always be ignored
  ignoredRepositories.push(repo);

  let reposList;

  try {
    reposList = await getReposList(octokit, dependencyName, owner);
  } catch (error) {
    core.setFailed(`Action failed while getting list of repos to process: ${ error}`);
  }

  core.debug('DEBUG: List of all repos returned by search without duplicates:');
  // TO-DO convert to core.debug after testing
  console.debug(JSON.stringify(reposList, null, 2));

  if (!reposList.length) {
    core.info(`No dependants found. No version bump performed. Looks like you do not use ${dependencyName} in your organization :man_shrugging:`);
    return;
  }
  core.startGroup(`Iterating over ${reposList.length} repos from ${owner} that have ${dependencyName} in their package.json. The following repos will be later ignored: ${ignoredRepositories}`);

  await processRepos({
    reposList,
    ignoredRepositories,
    dependencyName,
    dependencyVersion,
    baseBranchName,
    commitMessageProd,
    commitMessageDev,
    customId,
    octokit
  });

  core.endGroup();
}

/**
 * @description Process repositories to install/update dependencies
 * @param {Object} param
 * @param {Array<Object>} param.reposList list of repositories with paths to package.json files
 * @param {Array<String>} param.ignoredRepositories list of repository names to ignore
 * @param {String} param.dependencyName name of the dependency to install/update
 * @param {String} param.dependencyVersion version of the dependency to install/update
 * @param {String} param.baseBranchName optional base branch name where changes should be applied, if not provided default branch will be used
 * @param {String} param.commitMessageProd commit message to use if dependency is found in prod dependencies
 * @param {String} param.commitMessageDev commit message to use if dependency is found in dev dependencies
 * @param {String|Boolean} param.customId if provided it means we should not create a new PR right away but first check if maybe there is an existing one we can just update
 * @param {Object} param.octokit authenticated octokit instance
 */
async function processRepos({
  reposList,
  ignoredRepositories,
  dependencyName,
  dependencyVersion,
  baseBranchName,
  commitMessageProd,
  commitMessageDev,
  customId,
  octokit
}) {
  const [owner] = process.env.GITHUB_REPOSITORY.split('/');
  for (const {paths: filepaths, repository: { name, html_url, node_id }} of reposList) {
    if (ignoredRepositories.includes(name)) continue;

    let existingBranchName = null;
    // if customId was provided it means we should not create a new PR right away but first check if maybe there is an existing one we can just update
    if (customId) {
      //if we get branch name instead of null then it means later we will skip branch creation and pr creation but operate on existing branch
      existingBranchName = await getExistingPr(octokit, name, owner, prIdentifierComment(customId));
    }

    const baseBranchWhereApplyChanges = existingBranchName || baseBranchName || await getRepoDefaultBranch(octokit, name, owner);
    const branchName = existingBranchName || `bot/bump-${dependencyName}-${dependencyVersion}`;
    const { git, cloneDir, success: setupSuccess } = await setupRepo(name, html_url, baseBranchWhereApplyChanges, branchName, existingBranchName);
    if (!setupSuccess) continue;

    const installResult = await installDependencyInRepo(cloneDir, filepaths, dependencyName, dependencyVersion, name);
    if (!installResult.success) continue;

    const repoDependencyType = installResult.repoDependencyType;
    const commitMessage = repoDependencyType === 'PROD' ? commitMessageProd : commitMessageDev;
 
    await pushChanges({
      branchName,
      html_url,
      node_id,
      name,
      git,
      commitMessage,
      existingBranchName,
      customId,
      octokit,
      baseBranchWhereApplyChanges
    });
  }
}

/**
 * @description Push changes to remote and create PR if needed
 * @param {Object} params 
 * @param {string} params.branchName
 * @param {string} params.html_url
 * @param {string} params.node_id
 * @param {string} params.name
 * @param {Object} params.git
 * @param {string} params.commitMessage
 * @param {string|null} params.existingBranchName
 * @param {string|boolean} params.customId
 * @param {Object} params.octokit
 * @param {string} params.baseBranchWhereApplyChanges
 * @returns {Promise<Object>} { pullRequestUrl, success }
 */
async function pushChanges({
  branchName,
  html_url,
  node_id,
  name,
  git,
  commitMessage,
  existingBranchName,
  customId,
  octokit,
  baseBranchWhereApplyChanges
}) {
  const gitHubKey = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });
  const committerUsername = core.getInput('committer_username') || 'web-flow';
  const committerEmail = core.getInput('committer_email') || 'noreply@github.com';

  core.info(`Pushing changes to remote to branch ${branchName} located in ${html_url}.`);
  try {
    await push(gitHubKey, html_url, branchName, commitMessage, committerUsername, committerEmail, git);
  } catch (error) {
    core.warning(`Pushing changes failed: ${ error}`);
    return {
      pullRequestUrl: null,
      success: false
    };
  }

  let pullRequestUrl;
  if (!existingBranchName) {
    core.info('Creating PR');
    try {
      if (customId) {
        pullRequestUrl = await createPr(octokit, branchName, node_id, commitMessage, baseBranchWhereApplyChanges, prIdentifierComment(customId));
      } else {
        pullRequestUrl = await createPr(octokit, branchName, node_id, commitMessage, baseBranchWhereApplyChanges);
      }
    } catch (error) {
      core.warning(`Opening PR failed: ${ error}`);
      core.info('Attempting to remove branch that was initially pushed to remote');
      try {
      //we should cleanup dead branch from remote if PR creation is not possible
        await removeRemoteBranch(branchName, git);
      } catch (error) {
        core.warning(`Could not remove branch in remote after failed PR creation: ${ error}`);
      }
      
      return {
        pullRequestUrl: null,
        success: false
      };
    }

    core.info(`Finished with success and PR for ${name} is created -> ${pullRequestUrl}`);
    return;
  } 
  core.info(`Finished with success and new changes pushed to existing remote branch called ${existingBranchName}`);
}

/**
 * @description Prepare repository clone and branch
 * @param {string} name 
 * @param {string} html_url 
 * @param {string} baseBranchWhereApplyChanges 
 * @param {string} branchName 
 * @param {string} existingBranchName 
 * @returns {Promise<Object>} { success, git, cloneDir }
 */
async function setupRepo(name, html_url, baseBranchWhereApplyChanges, branchName, existingBranchName) {
  const cloneDir = path.join(process.cwd(), './clones', name);

  try {
    await mkdir(cloneDir, {recursive: true});
  } catch (error) {
    core.warning(`Unable to create directory where close should end up: ${ error}`);
  }

  const git = simpleGit({baseDir: cloneDir});
  core.info(`Cloning ${name} with branch ${baseBranchWhereApplyChanges} from ${html_url}.`);
  try {
    await clone(html_url, cloneDir, baseBranchWhereApplyChanges, git);
  } catch (error) {
    core.warning(`Cloning failed: ${ error}`);
    return { success: false };
  }

  if (!existingBranchName) {
    core.info(`Creating branch ${branchName}.`);
    try {
      await createBranch(branchName, git);
    } catch (error) {
      core.warning(`Branch creation failed: ${ error}`);
      return { success: false };
    }
  }

  return { success: true, git, cloneDir };
}

/**
 * @description Iterate package.json filepaths in a cloned repo, verify dependency and run install
 * @param {string} cloneDir
 * @param {Array<string>} filepaths
 * @param {string} dependencyName
 * @param {string} dependencyVersion
 * @param {string} repoName
 * @returns {Promise<Object>} { success, repoDependencyType }
 */
async function installDependencyInRepo(cloneDir, filepaths, dependencyName, dependencyVersion, repoName) {
  let repoDependencyType;

  for (const filepath of filepaths) {
    //Sometimes there might be files like package.json.js or similar as the repository might contain some templated package.json files that cannot be parsed from string to JSON
    //Such files must be ignored 
    if (filepath.substring(filepath.lastIndexOf('/') + 1) !== 'package.json') {
      core.info(`Ignoring ${filepath} from ${repoName} repo as only package.json files are supported`);
      continue;
    }

    core.info('Checking if dependency is prod, dev or both');
    const packageJsonLocation = path.join(cloneDir, filepath);
    let packageJson;
    let dependencyType;
    try {
      packageJson = await readPackageJson(packageJsonLocation);
      dependencyType = verifyDependencyType(packageJson, dependencyName);
    } catch (error) {
      core.warning(`Verification of dependency failed: ${ error}`);
      continue;
    }
      
    if (dependencyType === 'NONE') {
      core.info(`We could not find ${dependencyName} neither in dependencies property nor in the devDependencies property. No further steps will be performed. It was found as GitHub search is not perfect and you probably use a package with similar name.`);
      continue;
    }

    core.info(`Bumping ${dependencyName} in file ${filepath} in ${repoName} repo`);
    try {
      await installDependency(dependencyName, dependencyVersion, packageJsonLocation);
    } catch (error) {
      core.warning(`Dependency installation failed: ${ error}`);
      continue;
    }

    if (dependencyType === 'PROD') {
      repoDependencyType = 'PROD';
    }
  }

  return { success: true, repoDependencyType };
}

async function run() {
  const packageJsonPath = process.env.PACKAGE_JSON_LOC || core.getInput('packagejson_path') || './';
  let packageJsonPathList = parseCommaList(process.env.PACKAGE_JSON_LIST_LOC || core.getInput('packagejson_path_list') || '');
  const search = (process.env.SEARCH || core.getInput('search')) === 'true';
  const ignorePaths = parseCommaList(process.env.IGNORE_PATHS || core.getInput('ignore_paths') || '');

  const gitHubKey = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });
  const octokit = github.getOctokit(gitHubKey);

  if (search) {
    const repoName = process.env.GITHUB_REPOSITORY;
    packageJsonPathList = await getPackageJsonList(octokit, repoName);
    if (ignorePaths.length) {
      packageJsonPathList = packageJsonPathList.filter(p => !ignorePaths.some(ignored => p.includes(ignored)));
    }
  }

  if (packageJsonPathList.length) {
    core.info(`We will process multiple package.json files provided as a list: ${JSON.stringify(packageJsonPathList, null, 2)}`);
    for (const singlePath of packageJsonPathList) {
      await runForPackage(singlePath, octokit);
    }
  } else {
    core.info(`We will process single package.json file located in ${packageJsonPath}`);
    await runForPackage(packageJsonPath, octokit);
  }
}

run();
