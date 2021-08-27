module.exports = { getReposList, createPr, getRepoDefaultBranch };

async function getReposList(octokit, name, owner) {
  const { data: { items } } = await octokit.search.code({
    q: `"${name}" user:${owner} in:file filename:package.json`
  });

  const deduplicatedReposList = reposList.reduce((prevItem, currentItem) => {
    if (prevItem.find(item => item.repository.id == currentItem.repository.id)) return prevItem;
    prevItem.push(currentItem);
  
    return prevItem;
  }, []);

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
