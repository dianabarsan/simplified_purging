import fs from 'node:fs';
import * as readline from 'readline';
import path from 'path';

const readIdsFromFile = async (filePath, processLine) => {
  let promise = Promise.resolve();
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  rl.on('line', (line) => promise = promise.then(() => processLine(line)));

  await new Promise((resolve, reject) => {
    rl.on('error', reject);
    rl.on('close', () => promise.then(resolve));
  });
};

export const getIdsFromFile = async (filePath, fileName) => {
  const collection = {};
  const processLine = (line) => {
    if (line.startsWith('uuid,')) {
      return;
    }
    const lineArr = line.split(',');
    const docId = lineArr[0];
    const dbName = lineArr[1];
    collection[dbName] = collection[dbName] || [];
    collection[dbName].push(docId);
  }
  await readIdsFromFile(path.join(filePath, fileName), processLine);

  return collection;
}

export const getFiles = async (filePath) => {
  return await fs.promises.readdir(filePath);
};
