const { parseCommaList, verifyDependencyType } = require('../lib/utils');

describe('parseCommaList()', () => {
  it('parses role model string without issues', () => {
    const list = 'test1, test2, test3, test4';
    const parsed = parseCommaList(list);

    expect(parsed).toStrictEqual(['test1', 'test2', 'test3', 'test4']);
  });

  it('parses string with many spaces between commas', () => {
    const list = 'test1   , test2,    test3, test4';
    const parsed = parseCommaList(list);

    expect(parsed).toStrictEqual(['test1', 'test2', 'test3', 'test4']);
  });

  it('parses string if quotes are used', () => {
    const list = '\'test1\'   , \'test2\',    "test3", "test4"';
    const parsed = parseCommaList(list);

    expect(parsed).toStrictEqual(['test1', 'test2', 'test3', 'test4']);
  });
});

describe('verifyDependencyType()', () => {
  it('returns NONE type if neither dependencies nor devDependencies are in the file', () => {
    const parsedPackageJson = {
      name: '@my/test1',
      version: '1.0.0'
    };

    const nameOfDependencyToCheck = '@my/test1';
    const verifyResult = verifyDependencyType(parsedPackageJson, nameOfDependencyToCheck); 
    
    expect(verifyResult).toStrictEqual('NONE');
  });

  it('returns NONE type if verified package is neither in dependencies nor in devDependencies', () => {
    const parsedPackageJson = {
      name: '@my/test1',
      version: '1.0.0',
      dependencies: {
        '@my/test2': '0.0.1'
      },
      devDependencies: {
        '@my/test2': '0.0.1'
      }
    };

    const nameOfDependencyToCheck = '@my/test1';
    const verifyResult = verifyDependencyType(parsedPackageJson, nameOfDependencyToCheck); 
    
    expect(verifyResult).toStrictEqual('NONE');
  });

  it('returns PROD type if verified package is in dependencies', () => {
    const parsedPackageJson = {
      name: '@my/test1',
      version: '1.0.0',
      dependencies: {
        '@my/test1': '0.0.1'
      },
      devDependencies: {
        '@my/test2': '0.0.1'
      }
    };

    const nameOfDependencyToCheck = '@my/test1';
    const verifyResult = verifyDependencyType(parsedPackageJson, nameOfDependencyToCheck); 
    
    expect(verifyResult).toStrictEqual('PROD');
  });

  it('returns DEV type if verified package is in devDependencies', () => {
    const parsedPackageJson = {
      name: '@my/test1',
      version: '1.0.0',
      dependencies: {
        '@my/test2': '0.0.1'
      },
      devDependencies: {
        '@my/test1': '0.0.1'
      }
    };

    const nameOfDependencyToCheck = '@my/test1';
    const verifyResult = verifyDependencyType(parsedPackageJson, nameOfDependencyToCheck); 
    
    expect(verifyResult).toStrictEqual('DEV');
  });

  it('returns PROD type if verified package is in dependencies and devDependencies', () => {
    const parsedPackageJson = {
      name: '@my/test1',
      version: '1.0.0',
      dependencies: {
        '@my/test1': '0.0.1'
      },
      devDependencies: {
        '@my/test1': '0.0.1'
      }
    };

    const nameOfDependencyToCheck = '@my/test1';
    const verifyResult = verifyDependencyType(parsedPackageJson, nameOfDependencyToCheck); 
    
    expect(verifyResult).toStrictEqual('PROD');
  });
});