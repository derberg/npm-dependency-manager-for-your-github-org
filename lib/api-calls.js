module.exports = { getReposList, createPr, getRepoDefaultBranch };

async function getReposList(octokit, name, owner) {
  const { data: { items } } = await octokit.search.code({
    q: `"${name}" user:${owner} in:file filename:package.json`
  });
  
  let processedRepo = {};
  // filter() returns only the repos that are not present in processedRepo object, and adds them there to the list
  const deduplicatedReposList = items.filter(({ repository: { id }}) => !processedRepo[id] && (processedRepo[id] = true));

  return deduplicatedReposList;
}

async function createPr(octokit, branchName, id, commitMessage, defaultBranch) {
  const createPrMutation =
    `mutation createPr($branchName: String!, $id: String!, $commitMessage: String!, $defaultBranch: String!) {
      createPullRequest(input: {
        baseRefName: $defaultBranch,
        headRefName: $branchName,
        title: $commitMessage,
        repositoryId: $id
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
    defaultBranch
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
