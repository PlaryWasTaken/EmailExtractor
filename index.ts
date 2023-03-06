import * as discord from 'discord.js';
import {Worker} from 'worker_threads';
import * as fs from 'fs';
import {PSTFile, PSTFolder} from "pst-extractor";
import * as cliProgress from 'cli-progress';
import chalk from 'chalk';
import {terminal} from "terminal-kit";

import * as os from "os";
let threadCount = os.availableParallelism()
let domains = new discord.Collection<string, string[]>();
const activeWorkers: Worker[] = [];
const startingData = {domains: domains, path: '', filePath: 'F:\\apps\\a.pst'}
const queue: any[] = [];
const finished: any[] = [];

const Chalk = new chalk.Instance({level: 3});
const multiBar = new cliProgress.MultiBar({
    barsize: 80,
    format: '{name} | ' + chalk.hex('#ffffff')('{bar}') + ` | ${chalk.hex('#aa00ff')('{percentage}%')} | {value}/{total}`,
    forceRedraw: false,
    hideCursor: true,
    fps: 20
})

const paths: string[] = [];
const pathsCompleted = new Set();

function recurseThroughFolders(folder: PSTFolder, path: string): string[] {
    const paths = [];
    if (folder.hasSubfolders) {
        const folders = folder.getSubFolders();
        for (const folder of folders) {
            paths.push(...recurseThroughFolders(folder, path + '.' + folder.displayName));
        }
    } else {
        paths.push(path + '.' + folder.displayName);
    }
    return paths;
}
const validEmails:string[] = []
const invalidEmails:string[] = []
let totalEmailsChecked = 0
function getSubfolders(path: string, filePath: string, mainProgress: cliProgress.SingleBar, bars: Map<string, cliProgress.SingleBar>, allPaths: string[]) {
    const worker = new Worker('./worker.js', {workerData: {domains: domains, path: path, filePath: filePath}});
    activeWorkers.push(worker);
    worker.on('message', (data) => {
        if (data.msg) {
            // console.log(data.msg);
        }
        if (data.createBar) {
            totalEmailsChecked += data.contentCount
            bars.set(data.folderName, multiBar.create(data.contentCount, 0, {name: data.folderName}))
        }
        if (data.increment) {
            bars.get(data.folderName)?.increment();
        }
        if (data.summonWorker) {
            paths.push(data.childPath);
            if (paths.length > allPaths.length) {
                allPaths = paths;
            }
            queue.push(data);
        }
        if (data.finished) {
            console.clear()
            pathsCompleted.add(data.currentPath)
            const a = pathsCompleted.size / allPaths.length * 100
            mainProgress.update(Math.floor(a))
            const b = bars.get(data.folderName)
            if (b) {
                b.stop();
                multiBar.remove(b);
            }
            activeWorkers.splice(activeWorkers.indexOf(worker), 1);

            validEmails.push(...data.validEmails)
            invalidEmails.push(...data.invalidEmails)


            for (const domain of data.domains) {
                if (domains.has(domain[0])) {
                    domains.get(domain[0])?.push(...domain[1]);
                } else {
                    domains.set(domain[0], domain[1]);
                }
            }
            if (queue.length === 0 && activeWorkers.length === 0) {
                mainProgress.stop()
                const domainNames = Array.from(domains.keys());
                fs.writeFileSync('domains.txt', domainNames.join('\n'));

                fs.writeFileSync('emails.txt', validEmails.join('\n'));
                terminal.clear();
                ended = true;
                console.log(chalk.green(`Processo finalizado!`) +
                `\n${chalk.blue(`Foram checados um total de ${totalEmailsChecked} emails e ${validEmails.length + invalidEmails.length} enderecos de email.`)}\nForam encontrados ${validEmails.length} emails ${chalk.green('válidos')} e ${invalidEmails.length} enderecos de emails unicos ${chalk.red('inválidos')} foram encontrados.\nAperte qualquer tecla para sair`)
            }
            if (queue.length > 0) {
                const next = queue.shift();
                finished.push(next);
                //console.log(next.childPath)
                getSubfolders(next.childPath, filePath, mainProgress, bars, allPaths);
                while (activeWorkers.length <= threadCount && queue.length > 0) {
                    const next = queue.shift();
                    finished.push(next);
                    //console.log(next.childPath)
                    getSubfolders(next.childPath, filePath, mainProgress, bars, allPaths);
                }

            }

        }

    })
}

let ended = false;
terminal('Escolha um arquivo PST: ');
terminal.fileInput({baseDir: '../'}, (error, path) => {
    if (error) {
        console.error(error);
        return;
    } else {

        console.log('\n' + chalk.green('File selected: ' + path));
        try {
            const testFile = new PSTFile(path);
        } catch (e) {
            console.log(chalk.red('O arquivo selecionado não é um arquivo PST válido!'));
            process.exit(0);
        }
        terminal.grabInput(true);
        console.log(chalk.green(`Pressione ENTER para iniciar o processo de extração de emails e domínios com ${threadCount} threads. Ctrl+C para cancelar. Ctrl + Q para modificar a quantidade de threads.`))
        terminal.on('key', (name: string, matches: any, data: any) => {
            if (ended) {
                process.exit(0);
            }
            if (name === 'ENTER' && !ended) {
                terminal.grabInput(false);
                const file = new PSTFile(path);
                const mainFolder = file.getRootFolder();
                const allPaths = recurseThroughFolders(mainFolder, '')
                const mainProgress = multiBar.create(100, 0, {
                    name: Chalk.hex('#ffaaff')('Main Progress'),
                    color: chalk.blue('')
                })
                const bars = new Map<string, cliProgress.SingleBar>();
                getSubfolders(startingData.path, path, mainProgress, bars, allPaths);
                terminal.hideCursor(false);
            }
            if (name === 'CTRL_C') {
                terminal.grabInput(false);
                process.exit(0);
            }
            if (name === 'CTRL_Q') {
                terminal.clear();
                terminal('Digite a quantidade de threads: ');
                terminal.grabInput(false);
                terminal.inputField({}, (error, input) => {
                    if (error) {
                        console.error(error);
                        return;
                    } else {
                        if (!input) return;
                        if (parseInt(input) > os.availableParallelism()) {
                            terminal(chalk.red(`A quantidade de threads não pode ser maior que a quantidade de threads disponíveis no seu computador. (${os.availableParallelism()})`))
                            process.exit(0);
                        }
                        threadCount = parseInt(input);
                        console.log(chalk.green(`Threads alteradas para ${threadCount}`))
                        terminal.grabInput(true);
                    }
                })
            }
        })
    }
})
