import cmd from 'node-cmd';
import config from './config/default';
import { promisify } from 'util';

const ip = '';
const ipB = '';
console.log(cmd);
// eslint-disable-next-line no-unused-vars
const cmdAsync: (arg0: string) => Promise<unknown> = promisify(cmd.run);
// create dump of db

async function makeBackup() {
  try {
    const date = new Date().getTime();
    await cmdAsync('rm -rf dumpOld.tar.gz');
    await cmdAsync(`mongodump --db ${config.database.database}`);
    await cmdAsync(`tar -czvf sspMongoDump${date}.tar.gz dump`);
    await cmdAsync('rm -rf dump');
    await cmdAsync(
      `rsync -avz -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" --progress sspMongoDump${date}.tar.gz ${ip}:/root/sspBackupDumps/`,
    );
    await cmdAsync(
      `rsync -avz -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" --progress sspMongoDump${date}.tar.gz ${ipB}:/root/sspBackupDumps/`,
    );
    await cmdAsync(`mv sspMongoDump${date}.tar.gz dumpOld.tar.gz`);
  } catch (error) {
    console.log(error);
  }
}

makeBackup();
setInterval(
  async () => {
    makeBackup();
  },
  60 * 60 * 1000,
);