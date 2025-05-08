const core = require('@actions/core');

module.exports = { getReposList, createPr, getRepoDefaultBranch, getExistingPr };

async function getReposList(octokit, name, owner) {
  const { data: { items } } = await octokit.search.code({
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
  }, []);
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

async function getRepoDefaultBranch(octokit, repo, owner) {
  const { data: { default_branch } } = await octokit.repos.get({
    owner,
    repo
  });

  return default_branch;
}

//it either return null which means that there are no existing open PRs 
//or the name of the branch of existing PR to checkout
async function getExistingPr(octokit, repo, owner, customId) {
  const { data: { items } } = await octokit.search.issuesAndPullRequests({
    q: `"${customId}" repo:${owner}/${repo} type:pr is:open`,
  });
  
  if (!items || items.length === 0) return null;

  //in case due to sume random issue there are more than on bot PRs, we just pick first from list
  const firstPR = items[0];
  core.info('Found PRs:');
  core.info(JSON.stringify(items, null, 2));
  core.info('PR that bot operates on:');
  core.info(JSON.stringify(firstPR, null, 2));
  const pullInfo = await octokit.pulls.get({
    owner,
    repo,
    pull_number: firstPR.number,
  });
  core.info('More details about the PR:');
  core.info(JSON.stringify(pullInfo.data, null, 2));
  return pullInfo.data.head.ref;
}