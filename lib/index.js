const github = require('@actions/github');
const core = require('@actions/core');
const simpleGit = require('simple-git');
const path = require('path');
const {mkdir} = require('fs').promises;

const { createBranch, clone, push } = require('./git');
const { getReposList, createPr, getRepoDefaultBranch } = require('./api-calls');
const { readPackageJson, parseCommaList, verifyDependencyType, installDependency } = require('./utils');

/* eslint-disable sonarjs/cognitive-complexity */
/**
 * Disabled the rule for this function as there is no way to make it shorter in a meaningfull way.
 * It looks complex because of extensive usage of core package to log as much as possible
 */
async function run() {
  try {
    const gitHubKey = process.env.GITHUB_TOKEN || core.getInput('github_token', { required: true });
    const committerUsername = core.getInput('committer_username') || 'web-flow';
    const committerEmail = core.getInput('committer_email') || 'noreply@github.com';
    const commitMessageProd = core.getInput('commit_message_prod') || 'Update dependency';
    const commitMessageDev = core.getInput('commit_message_dev') || 'Update devDependency';
    const packageJsonPath = process.env.PACKAGE_JSON_LOC || core.getInput('packagejson_loc') || './';
    const reposToIgnore = core.getInput('repos_to_ignore');

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    const octokit = github.getOctokit(gitHubKey);
    const ignoredRepositories = reposToIgnore ? parseCommaList(reposToIgnore) : [];
    //by default repo where workflow runs should always be ignored
    ignoredRepositories.push(repo);

    const { name: dependencyName, version: dependencyVersion} = await readPackageJson(path.join(process.cwd(), packageJsonPath, 'package.json'));
    core.info(`Identified dependency name as ${dependencyName} with version ${dependencyVersion}. Now it will be bumped in dependent projects.`);

    const reposList = await getReposList(octokit, dependencyName, owner);
    const foundReposAmount = reposList.length;
    if (!foundReposAmount) return core.info(`No dependants found. No version bump performed. Looks like you do not use ${dependencyName} in your organization :man_shrugging:`);

    core.startGroup(`Iterating over ${foundReposAmount} from ${owner} that have ${dependencyName} in their package.json.`);

    for (const {path: filepath, repository: { name, html_url, node_id }} of reposList) {
      if (ignoredRepositories.includes(name)) continue;

      const cloneDir = path.join(process.cwd(), './clones', name);
      await mkdir(cloneDir, {recursive: true});

      const branchName = `bot/bump-${dependencyName}-${dependencyVersion}`;
      const git = simpleGit({baseDir: cloneDir});

      core.info(`Clonning ${name}.`);
      await clone(html_url, cloneDir, git);
      
      core.info(`Creating branch ${branchName}.`);
      await createBranch(branchName, git);
      
      core.info('Checking if dependency is prod, dev or both');
      const packageJsonLocation = path.join(cloneDir, filepath);
      const packageJson = await readPackageJson(packageJsonLocation);
      const dependencyType = await verifyDependencyType(packageJson, dependencyName);
      if (dependencyType === 'NONE') {
        core.info(`We could not find ${dependencyName} neither in dependencies property nor in the devDependencies property. No further steps will be performed. It was found as GitHub search is not perfect and you probably use a package with similar name.`);
        continue;
      }

      core.info('Bumping version');
      await installDependency(dependencyName, dependencyVersion, packageJsonLocation);
      const commitMessage = dependencyType === 'PROD' ? commitMessageProd : commitMessageDev;

      core.info('Pushing changes to remote');
      await push(gitHubKey, html_url, branchName, commitMessage, committerUsername, committerEmail, git);
      
      core.info('Creating PR');
      const pullRequestUrl = await createPr(octokit, branchName, node_id, commitMessage, await getRepoDefaultBranch(octokit, name, owner));
      
      core.info(`Finished with success and PR for ${name} is created -> ${pullRequestUrl}`);
    }

    core.endGroup();
  } catch (error) {
    core.setFailed(`Action failed because of: ${ error}`);
  }
}

run();
