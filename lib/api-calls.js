import * as core from '@actions/core';

export { getReposList, createPr, getRepoDefaultBranchAndPackageManager, getExistingPr, getPackageJsonList };

async function getReposList(octokit, name, owner) {
  const { data: { items } } = await octokit.rest.search.code({
    q: `"${name}" user:${owner} in:file filename:package.json`
  });
  
  // Groups paths by repository id
  return items.reduce((acc, item) => {
    const index = acc.findIndex(repo => repo.repository.id === item.repository.id);
    const path = item.path;
    delete item.path;
    if (index === -1) {
      acc.push({ ...item, paths: [path] });
    } else {
      acc[index].paths.push(path);
    }

    return acc;
  }, []).map(({ repository, paths }) => ({ repository: {
    name: repository.name,
    html_url: repository.html_url,
    node_id: repository.node_id,
    id: repository.id
  } , paths }));
}

async function getPackageJsonList(octokit, repo) {
  const { data: { items } } = await octokit.rest.search.code({
    q: `repo:${repo} in:file filename:package.json`
  });

  return items.map(item => item.path.replace(/package.json$/, ''));
}

async function createPr(octokit, branchName, id, commitMessage, defaultBranch, body = '') {
  const createPrMutation =
    `mutation createPr($branchName: String!, $id: ID!, $commitMessage: String!, $defaultBranch: String!, $body: String!) {
      createPullRequest(input: {
        baseRefName: $defaultBranch,
        headRefName: $branchName,
        title: $commitMessage,
        repositoryId: $id,
        body: $body
      }){
        pullRequest {
          url
        }
      }
    }
    `;

  const newPrVariables = {
    branchName,
    id,
    commitMessage,
    defaultBranch,
    body
  };

  const { createPullRequest: { pullRequest: { url: pullRequestUrl } } } = await octokit.graphql(createPrMutation, newPrVariables);

  return pullRequestUrl;
}

async function getRepoDefaultBranchAndPackageManager(octokit, repo, owner) {
  const { data: { default_branch, topics } } = await octokit.rest.repos.get({
    owner,
    repo
  });

  // Currently only pnpm, yarn, bun and npm are supported
  let packageManager;
  switch (true) {
  case topics.includes('pnpm'):
    packageManager = 'pnpm';
    break;
  case topics.includes('yarn'):
    packageManager = 'yarn';
    break;
  case topics.includes('bun'):
    packageManager = 'bun';
    break;
  case topics.includes('npm'):
    packageManager = 'npm';
    break;
  default:
    packageManager = undefined;
  }

  return { default_branch, packageManager };
}

//it either return null which means that there are no existing open PRs 
//or the name of the branch of existing PR to checkout
async function getExistingPr(octokit, repo, owner, customId) {
  const { data: { items } } = await octokit.rest.search.issuesAndPullRequests({
    q: `"${customId}" repo:${owner}/${repo} type:pr is:open`,
    // As non-advanced search is being deprecated, we switch to advanced search to avoid issues in future
    // More info: https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-issues-and-pull-requests 
    // https://github.blog/changelog/2025-03-06-github-issues-projects-api-support-for-issues-advanced-search-and-more/
    advanced_search: true
  });
  
  if (!items || items.length === 0) return null;

  //in case due to some random issue there are more than one bot PRs, we just pick first from list
  const firstPR = items[0];
  core.info('Found PRs:');
  core.info(JSON.stringify(items.map(i => ({number: i.number, title: i.title, url: i.html_url})), null, 2));
  core.info('PR that bot operates on:');
  core.info(JSON.stringify({number: firstPR.number, title: firstPR.title, url: firstPR.html_url}, null, 2));
  const pullInfo = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: firstPR.number,
  });
  core.debug('More details about the PR:');
  // core.debug(JSON.stringify(pullInfo.data, null, 2));
  return pullInfo.data.head.ref;
}