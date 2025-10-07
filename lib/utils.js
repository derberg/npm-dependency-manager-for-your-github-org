import { readFile } from 'fs/promises';
import { execa } from 'execa';

export { readPackageJson, parseCommaList, verifyDependencyType, installDependency, prIdentifierComment, getPackageManager };

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
    throw new Error(`There was a problem parsing the package.json file from ${packageJsonPath} with the following content: ${packageFile}`, e);
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

function getPackageManager(packageJson) {
  if (!packageJson || !packageJson.packageManager) return undefined;

  const packageManagerField = packageJson.packageManager.toLowerCase().split('@')[0];
  
  if (['npm', 'yarn', 'pnpm', 'bun'].includes(packageManagerField)) {
    return packageManagerField;
  }

  return undefined;
}

async function installDependency(name, version, filepath, packageManager = 'npm') {
  const cwd = filepath.replace('package.json','');

  if (packageManager === 'yarn') {
    await execa(
      'yarn',
      ['add', `${name}@${version}`],
      {cwd}
    );
  } else {
    await execa(
      packageManager,
      ['add', `${name}@${version}`],
      {cwd}
    );
  }

  return true;
}

function prIdentifierComment(customId) {
  return `<!-- ${customId} -->`;
}