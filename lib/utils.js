const {readFile} = require('fs').promises;
const execa = require('execa');

module.exports = { readPackageJson, parseCommaList, verifyDependencyType, installDependency, prIdentifierComment };

/**
 * @param  {String} packageJsonPath location of package.json file
 * @returns parsed package.json
 */
async function readPackageJson(packageJsonPath) {
  let packageFile, parsedFile;

  try {
    packageFile = await readFile(packageJsonPath, 'utf8');
  } catch (e) {
    throw new Error(`There was a problem reading the package.json file from ${packageJsonPath}`, e);
  }
  try {
    parsedFile = JSON.parse(packageFile);
  } catch (e) {
    throw new Error(`There was a problem parsing the package.json file from ${packageJsonPath} with the following content: ${packageFile}`);
  }
  return parsedFile;
}

/**
 * @param  {String} list names of values that can be separated by comma
 * @returns  {Array<String>} input names not separated by string but as separate array items
 */
function parseCommaList(list) {
  return list.split(',').map(i => i.trim().replace(/['"]+/g, '')).filter(i => i);
}

/**
 * @param  {Object} json parsed package.json file
 * @param  {String} dependencyName name of the dependency
 * @returns  {String} type of dependency, PROD/DEV/NONE
 */
function verifyDependencyType(json, dependencyName) {
  const prodDependencies = json.dependencies;
  const devDependencies = json.devDependencies;

  const isProd = prodDependencies && prodDependencies[dependencyName];
  const isDev = devDependencies && devDependencies[dependencyName];

  if (isProd && isDev) return 'PROD';
  if (!isProd && !isDev) return 'NONE';
  return isProd ? 'PROD' : 'DEV';
}

async function installDependency(name, version, filepath) {
  const cwd = filepath.replace('package.json','');

  await execa(
    'npm',
    ['install', `${name}@${version}`],
    {cwd}
  );
  return true;
}

function prIdentifierComment(customId) {
  return `<!-- ${customId} -->`;
}