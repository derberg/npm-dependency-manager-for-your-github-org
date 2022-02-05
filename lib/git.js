module.exports = {createBranch, clone, push, removeRemoteBranch};

const remoteName = 'auth';

async function createBranch(branchName, git) {
  return await git
    .checkout(`-b${branchName}`);
}

async function clone(remote, dir, branchName, git) {
  return await git
    .clone(remote, dir, {'--depth': 1, '--branch': branchName});
}

async function push(token, url, branchName, message, committerUsername, committerEmail, git) {
  const authanticatedUrl = (token, url, user) => {
    const arr = url.split('//');
    return `https://${user}:${token}@${arr[arr.length - 1]}`;
  };

  return await git
    .add('./*')
    .addConfig('user.name', committerUsername)
    .addConfig('user.email', committerEmail)
    .commit(message)
    .addRemote(remoteName, authanticatedUrl(token, url, committerUsername))
    .push(['-u', remoteName, branchName]);
}

async function removeRemoteBranch(branchName, git) {
  return await git.push(['-u', remoteName, branchName, '--delete', '--force']);
}
  