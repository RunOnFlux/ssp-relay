import cmd from 'node-cmd';
import config from './config/default';
import { promisify } from 'util';

const ip = '';
const ipB = '';

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

makeBackup()
  .then(() => {
    console.log('Backup done');
  })
  .catch((error) => {
    console.log(error);
  });

setInterval(
  () => {
    makeBackup()
      .then(() => {
        console.log('Backup done');
      })
      .catch((error) => {
        console.log(error);
      });
  },
  1000 * 60 * 60,
);
