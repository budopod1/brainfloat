#!/usr/bin/env node

if (!Promise.withResolvers) {
    Promise.withResolvers = () => {
        let resolve, reject;
        let promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return {resolve, reject, promise};
    };
}

let fs = require("node:fs");
let path = require("node:path");
let { parseConstants, getEnvBF, runEnv, runBF } = require("./libbrainfloat.js");

const BRAINFLOAT_MACRO_EXT = ".bfm";
const BRAINFLOAT_CONST_EXT = ".bfc";

function showHelp() {
    console.log(`
bfloatc - command line brainfloat

options:
-h, --help        show this menu
--cell-size=<n>   set the max value of a cell to n-1, or unbounded if n=-1

usage:
bfloatc run <path>     run the program at <path>
bfloatc compile <src>  compile the brainfloat file <src>
bfloatc unpack <src>   unpack the brainfloat file <src> into a directory
bfloatc pack <src>     pack the brainfloat directory <src> into a file
`.trim());
    process.exit(0);
}

function showError(err) {
    let errTxt = err.toString();
    let errPrefix = "Error: ";
    if (errTxt.startsWith(errPrefix)) {
        errTxt = errTxt.slice(errPrefix.length);
    }
    console.log("\x1b[31mError:\x1b[0m "+errTxt);
    process.exit(1);
}

function parseEqArg(name, arg) {
    if (!arg.startsWith(name+"=")) {
        showError(`Expected '=' after '${name}'`);
    }
    if (arg.length <= name.length + 1) {
        showError(`Expected something after '${name}='`);
    }
    return arg.slice(name.length+1);
}

function parseOptions(env, args) {
    let remainingArgs = [];
    for (let i = 0; i < args.length; i++) {
        let arg = args[i];

        if (!arg.startsWith("-")) {
            remainingArgs.push(arg);
            continue;
        }

        if (arg.startsWith("--cell-size")) {
            let sizeStr = parseEqArg("--cell-size", arg);
            try {
                env.cellSize = parseInt(sizeStr);
            } catch (e) {
                showError(e);
            }
            continue;
        }

        showError(`Unexpected argument ${arg}`);
    }
    return remainingArgs;
}

let onNextInput;
let onInputEnd;

async function getInputChar() {
    while (!process.stdin.readableEnded) {
        let char = process.stdin.read(1);
        if (char != null) {
            return char.toString().charCodeAt(0);
        }
        let {promise, resolve, reject} = Promise.withResolvers();
        onNextInput = resolve;
        onInputEnd = reject;
        try {
            await promise;
        } finally {
            onNextInput = null;
            onInputEnd = null;
        }
    }
    return 0;
}

function readFile(path) {
    try {
        return fs.readFileSync(path).toString();
    } catch (e) {
        showError(e);
    }
}

function writeFile(path, txt) {
    try {
        fs.writeFileSync(path, txt);
    } catch (e) {
        showError(e);
    }
}

function isDirectory(path) {
    return fs.lstatSync(path).isDirectory();
}

function listFolderFiles(dir) {
    try {
        return fs.readdirSync(dir)
            .map(name => path.join(dir, name))
            .filter(path => !isDirectory(path));
    } catch (e) {
        showError(e);
    }
    
}

function changeFileExtension(file, currExt, newExt) {
    return file.slice(0, file.length - currExt.length) + newExt;
}

async function executeBFTxt(env, txt) {
    try {
        await runBF(env, txt);
    } catch (e) {
        showError(e);
    }
}

function parseBFFloatTxt(env, txt) {
    try {
        let json = JSON.parse(txt);
        env.macros = json.macros;
        env.constantsTxt = json.constants;
        env.constants = parseConstants(env.constantsTxt);
    } catch (e) {
        showError(e);
    }
}

async function executeBFloatTxt(env, txt) {
    parseBFFloatTxt(env, txt);
    try {
        await runEnv(env);
    } catch (e) {
        showError(e);
    }
}

async function executeBFloatDirectory(env, dir) {
    loadBFloatDirectory(env, dir);
    try {
        await runEnv(env);
    } catch (e) {
        showError(e);
    }
}

function loadBFloatDirectory(env, dir) {
    env.constantsTxt = "";
    env.macros = [];
    for (let file of listFolderFiles(dir)) {
        let ext = path.extname(file);
        if (ext == BRAINFLOAT_CONST_EXT) {
            let fileTxt = readFile(file);
            if (fileTxt.at(-1) != "\n") {
                fileTxt += "\n";
            }
            env.constantsTxt += fileTxt;
        } else if (ext == BRAINFLOAT_MACRO_EXT) {
            let name = path.basename(file, ext);
            let content = readFile(file);
            env.macros.push({name, content});
        }
    }

    try {
        env.constants = parseConstants(env.constantsTxt);
    } catch (e) {
        showError(e);
    }
}

function clearBFloatDirectory(dir) {
    for (let file of listFolderFiles(dir)) {
        let ext = path.extname(file);
        if ((ext == BRAINFLOAT_MACRO_EXT)
            || (ext == BRAINFLOAT_CONST_EXT)) {
            fs.rmSync(file);
        }
    }
}

function writeBFloatDirectory(env, dir) {
    let constantsPath = path.join(dir, "constants"+BRAINFLOAT_CONST_EXT);
    writeFile(constantsPath, env.constantsTxt);
    for (let macro of env.macros) {
        let macroPath = path.join(dir, macro.name+BRAINFLOAT_MACRO_EXT);
        writeFile(macroPath, macro.content);
    }
}

function makeBFloatTxt(env) {
    return JSON.stringify({
        macros: env.macros,
        constants: env.constantsTxt
    });
}

async function executeFile(env, args) {
    if (args.length == 0) {
        showError("Not enough arguments; expected filename");
    }

    if (args.length > 1) {
        showError("Too many arguments");
    }

    let loc = args[0];

    let ext = path.extname(loc);

    if (ext == ".b" || ext == ".bf") {
        await executeBFTxt(env, readFile(loc));
    } else if (ext == ".json") {
        await executeBFloatTxt(env, readFile(loc));
    } else if (isDirectory(loc)) {
        await executeBFloatDirectory(env, loc);
    } else {
        showError(`Don't know how to run file with extension '${ext}'`);
    }
}

function compileFile(env, args) {
    if (args.length == 0) {
        showError("Not enough arguments; expected source filename");
    }

    if (args.length > 1) {
        showError("Too many arguments");
    }

    let src = args[0];

    let ext = path.extname(src);

    if (ext == ".json") {
        parseBFFloatTxt(env, readFile(src));
    } else if (isDirectory(ext)) {
        loadBFloatDirectory(env, src);
    } else {
        showError(`Don't know how to compile file with extension '${ext}'`);
    }

    let result;
    try {
        result = getEnvBF(env);
    } catch (e) {
        showError(e);
    }

    let dest = changeFileExtension(src, ext, ".bf");
    writeFile(dest, result);
}

function unpackBFloatFile(env, args) {
    if (args.length == 0) {
        showError("Not enough arguments; expected source file");
    }

    if (args.length > 1) {
        showError("Too many arguments");
    }

    let src = args[0];
    let txt = readFile(src);
    
    let ext = path.extname(src);

    if (ext != ".json") {
        showError("Can only unpack .json brainfloat file");
    }

    parseBFFloatTxt(env, txt);

    let dest = changeFileExtension(src, ext, "");
    if (fs.existsSync(dest)) {
        if (!isDirectory(dest)) {
            showError("Cannot overwrite preexisting file");
        }
        clearBFloatDirectory(dest);
    } else {
        fs.mkdirSync(dest);
    }

    writeBFloatDirectory(env, dest);
}

function packBFloatDirectory(env, args) {
    if (args.length == 0) {
        showError("Not enough arguments; expected source directory");
    }

    if (args.length > 1) {
        showError("Too many arguments");
    }

    let src = args[0];

    loadBFloatDirectory(env, src);

    let dest = src + ".json";

    writeFile(dest, makeBFloatTxt(env));
}

(async () => {
    let args = process.argv.slice(2);

    if (args.includes("--help")
        || args.includes("-h")) showHelp();

    if (args.length < 1) {
        showError("Expected more arguments");
    }

    let mode = args[0];
    args = args.slice(1);

    process.stdin.on("readable", () => {
        onNextInput?.();
    });

    process.stdin.on("end", () => {
        onInputEnd?.();
    });

    let env = {
        sendOutput: c => process.stdout.write(String.fromCharCode(c)),
        getInput: getInputChar
    };
    args = parseOptions(env, args);
    
    switch (mode) {
    case "run":
        await executeFile(env, args);
        break;
    case "compile":
        compileFile(env, args);
        break;
    case "unpack":
        unpackBFloatFile(env, args);
        break;
    case "pack":
        packBFloatDirectory(env, args);
        break;
    default:
        showError(`Invalid mode ${mode}`);
        break;
    }

    process.exit(0);
})();
