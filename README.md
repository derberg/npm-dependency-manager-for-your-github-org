# Organization Projects' Dependency Manager
GitHub Action that handles automated update of dependencies in package.json between projects from the same GitHub organization.

<!-- toc -->

- [Why I Created This Action?](#why-i-created-this-action)
- [Action Flow](#action-flow)
- [Configuration](#configuration)
- [Examples](#examples)
  * [Minimum Workflow](#minimum-workflow)
  * [Advanced Workflow](#advanced-workflow)
- [Development](#development)

<!-- tocstop -->

## Why I Created This Action?

//TODO

## Action Flow

 <img src="diagram.png" alt="flow diagram" width="20%"> 

## Configuration

Name | Description | Required | Default
--|------|--|--
github_token | Token to use GitHub API. It must have "repo" scopes so it can push to repos. It cannot be the default GitHub Actions token GITHUB_TOKEN. GitHub Action token's permissions are limited to the repository that contains your workflows. Provide token of the user that has rights to push to the repos that this action is suppose to update.  | true | -
packagejson_path | Path to package.json file if not located in the root of the project. Provide just the path without file name. In the format: `./nested/location`. | false | `./`
committer_username | The username (not display name) of the committer will be used to commit changes in the workflow file in a specific repository. In the format `web-flow`. | false | `web-flow`
committer_email | The committer's email that will be used in the commit of changes in the workflow file in a specific repository. In the format `noreply@github.com`.| false | `noreply@github.com`
commit_message_prod | It is used as a commit message when bumping dependency from "dependencies" section in package.json. In case dependency is located in both dependencies and devDependencies of dependant, then prod commit message is used. It is also used as a title of the pull request that is created by this action. | false | `Update dependency`
commit_message_dev | It is used as a commit message when bumping dependency from "devDependencies" section in package.json. It is also used as a title of the pull request that is created by this action. | false | `Update devDependency`
repos_to_ignore | Comma-separated list of repositories that should not get updates from this action. Action already ignores the repo in which the action is triggered so you do not need to add it explicitly. In the format `repo1,repo2`. | false | -

## Examples

//TODO

### Minimum Workflow

### Advanced Workflow

## Development

```bash
# GITHUB_TOKEN provide personal GitHub token with scope to push to repos
# GITHUB_REPOSITORY provide name of org/user and the repo in which this workflow is suppose to run
# PACKAGE_JSON_LOC=test is a path to package.json file against you want to test
GITHUB_TOKEN=token PACKAGE_JSON_LOC=test GITHUB_REPOSITORY="lukasz-lab/.github" npm start
```

## TODO

This action should not be used yet. I need to:
- write decent amount of tests as this action can do some harm
- make final clarification of search usage
- provide examples