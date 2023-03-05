import {PSTFolder, PSTFile} from "pst-extractor";
import {parentPort, workerData, isMainThread} from 'worker_threads';
import {resolve} from "path";
import { Collection } from "discord.js";
import * as emailChecker from "email-addresses";
const file = new PSTFile(resolve(workerData.filePath));
const mainFolder = file.getRootFolder();
function validateEmail(email:string) {
    return emailChecker.parseOneAddress(email) !== null;
}

function findCurrentFolder(path: string) {
    parentPort?.postMessage({ pathReceived: path })
    const pathArray = path.split('.');
    let currentFolder = mainFolder;
    parentPort?.postMessage({ currentPath: '' })
    for (let i = 1; i < pathArray.length; i++) {
        parentPort?.postMessage({ currentPathLoop: pathArray[i] })
        const folders = currentFolder.getSubFolders();
        const folder = folders.find((folder:PSTFolder) => folder.displayName === pathArray[i]);
        if (!folder) throw new Error("Folder not found");
        currentFolder = folder;
    }
    return currentFolder;
}
if (isMainThread) {
    throw new Error("This file is not meant to be run in the main thread.");
} else {
    async function main() {
        if (!parentPort) throw new Error("This file is not meant to be run in the main thread.");
        const domains = new Collection<string, string[]>();
        const emailsUsed = new Set();
        const folder = findCurrentFolder(workerData.path)
        if (folder.hasSubfolders) {
            parentPort.postMessage({ folderName: folder.displayName, hasSubfolders: true })
            let childFolders = folder.getSubFolders();
            parentPort.postMessage({ childFolders: childFolders.length })
            for (let childFolder of childFolders) {
                parentPort.postMessage({ summonWorker: true, folder: folder.displayName, currentPath: workerData.path, childFolder: childFolder.displayName, childPath: workerData.path + '.' + childFolder.displayName, domains: domains  })
            }
        }
        if (folder.contentCount > 0) {
            parentPort.postMessage({ createBar: true, folderName: folder.displayName, contentCount: folder.contentCount })
            let email = folder.getNextChild();
            while (email != null) {
                parentPort.postMessage({ increment: true, folderName: folder.displayName })
                const from = email.senderEmailAddress;
                emailsUsed.add(from);
                if (!emailsUsed.has(from)) {
                    const a = validateEmail(from)
                    if (from !== '') parentPort.postMessage({ msg: `Validating ${from}... ${a?'Valid':'Invalid'}` })
                    if (!a) continue;

                    const domain = from.split('@')[1];
                    if (domains.has(domain)) {
                        domains.get(domain)?.push(from);
                    } else {
                        domains.set(domain, [from]);
                    }

                }
                email = folder.getNextChild();
            }
        }
        parentPort.postMessage({ finished: true, domains: domains, folderName: folder.displayName, currentPath: workerData.path, contentCount: folder.contentCount })
    }
    main().then(() => {});
}