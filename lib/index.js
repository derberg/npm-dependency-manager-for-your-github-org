const github = require('@actions/github');
const core = require('@actions/core');
const simpleGit = require('simple-git');
const path = require('path');
const {mkdir} = require('fs').promises;

const { createBranch, clone, push, removeRemoteBranch } = require('./git');
const { getReposList, createPr, getRepoDefaultBranch, getExistingPr } = require('./api-calls');
const { readPackageJson, parseCommaList, verifyDependencyType, installDependency, prIdentifierComment } = require('./utils');

/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Disabled the rule for this function as there is no way to make it shorter in a meaningfull way.
 * It looks complex because of extensive usage of core package to log as much as possible
 */
async function run() {
  const gitHubKey = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });
  const committerUsername = core.getInput('committer_username') || 'web-flow';
  const committerEmail = core.getInput('committer_email') || 'noreply@github.com';
  const packageJsonPath = process.env.PACKAGE_JSON_LOC || core.getInput('packagejson_path') || './';
  const { name: dependencyName, version: dependencyVersion} = await readPackageJson(path.join(packageJsonPath, 'package.json'));
  core.info(`Identified dependency name as ${dependencyName} with version ${dependencyVersion}. Now it will be bumped in dependent projects.`);
  const commitMessageProd = core.getInput('commit_message_prod') || `fix: update ${dependencyName} to ${dependencyVersion} version and others`;
  const commitMessageDev = core.getInput('commit_message_dev') || `chore: update ${dependencyName} to ${dependencyVersion} version and others`;
  const reposToIgnore = core.getInput('repos_to_ignore');
  const baseBranchName = core.getInput('base_branch');
  const customId = core.getInput('custom_id') || false;

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const octokit = github.getOctokit(gitHubKey);
  const ignoredRepositories = reposToIgnore ? parseCommaList(reposToIgnore) : [];
  //by default repo where workflow runs should always be ignored
  ignoredRepositories.push(repo);
  let reposList;

  try {
    reposList = await getReposList(octokit, dependencyName, owner);
  } catch (error) {
    core.setFailed(`Action failed while getting list of repos to process: ${ error}`);
  }
    
  core.debug('DEBUG: List of all repost returned by search without duplicates:');
  core.debug(JSON.stringify(reposList, null, 2));
    
  const foundReposAmount = reposList.length;
  if (!foundReposAmount) return core.info(`No dependants found. No version bump performed. Looks like you do not use ${dependencyName} in your organization :man_shrugging:`);

  core.startGroup(`Iterating over ${foundReposAmount} repos from ${owner} that have ${dependencyName} in their package.json. The following repos will be later ignored: ${ignoredRepositories}`);

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
    const cloneDir = path.join(process.cwd(), './clones', name);

    try {
      await mkdir(cloneDir, {recursive: true});
    } catch (error) {
      core.warning(`Unable to create directory where close should end up: ${ error}`);
    }

    const git = simpleGit({baseDir: cloneDir});
    
    core.info(`Clonning ${name} with branch ${baseBranchWhereApplyChanges}.`);
    try {
      await clone(html_url, cloneDir, baseBranchWhereApplyChanges, git);
    } catch (error) {
      core.warning(`Cloning failed: ${ error}`);
      continue;
    }

    if (!existingBranchName) {
      core.info(`Creating branch ${branchName}.`);
      try {
        await createBranch(branchName, git);
      } catch (error) {
        core.warning(`Branch creation failes: ${ error}`);
        continue;
      }
    }

    let repoDependencyType;

    for (const filepath of filepaths) {
      //Sometimes there might be files like package.json.js or similar as the repository might contain some templated package.json files that cannot be parsed from string to JSON
      //Such files must be ignored 
      if (filepath.substring(filepath.lastIndexOf('/') + 1) !== 'package.json') {
        core.info(`Ignoring ${filepath} from ${name} repo as only package.json files are supported`);
        continue;
      }

      core.info('Checking if dependency is prod, dev or both');
      const packageJsonLocation = path.join(cloneDir, filepath);
      let packageJson;
      let dependencyType;
      try {
        packageJson = await readPackageJson(packageJsonLocation);
        dependencyType = await verifyDependencyType(packageJson, dependencyName);
      } catch (error) {
        core.warning(`Verification of dependency failed: ${ error}`);
        continue;
      }
        
      if (dependencyType === 'NONE') {
        core.info(`We could not find ${dependencyName} neither in dependencies property nor in the devDependencies property. No further steps will be performed. It was found as GitHub search is not perfect and you probably use a package with similar name.`);
        continue;
      }

      core.info(`Bumping ${dependencyName} in file ${filepath} in ${name} repo`);
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

    const commitMessage = repoDependencyType === 'PROD' ? commitMessageProd : commitMessageDev;

    core.info('Pushing changes to remote');
    try {
      await push(gitHubKey, html_url, branchName, commitMessage, committerUsername, committerEmail, git);
    } catch (error) {
      core.warning(`Pushing changes failed: ${ error}`);
      continue;
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
        continue;
      }

      core.info(`Finished with success and PR for ${name} is created -> ${pullRequestUrl}`);
    } else {
      core.info(`Finished with success and new changes pushed to existing remote branch called ${existingBranchName}`);
    }
  }

  core.endGroup();
}

run();
