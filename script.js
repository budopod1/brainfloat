async function idle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function parseBF(bf) {
    let result = [];
    let stack = [result];
    for (let char of bf) {
        let current = stack.at(-1);
        if (char == "+") {
            current.push({action: "incr"});
        } else if (char == "-") {
            current.push({action: "decr"});
        } else if (char == "<") {
            current.push({action: "left"});
        } else if (char == ">") {
            current.push({action: "right"});
        } else if (char == ".") {
            current.push({action: "output"});
        } else if (char == ",") {
            current.push({action: "input"});
        } else if (char == "~") {
            current.push({action: "dump"});
        } else if (char == "[") {
            let block = [];
            current.push({action: "loop", block});
            stack.push(block);
        } else if (char == "]") {
            stack.pop();
        }
    }
    return result;
}

let lastInput = "";
let onNextInput = null;
let cancelExecution = null;
let isRunning = false;
let isStopRequested = false;

function setIsRunning(running) {
    document.getElementById("stop-run").innerText = running ? "Stop" : "Run";
    isRunning = running;
}

function doDump(mem, i) {
    let str = "";
    for (let j in mem) {
        if (j % 8 == 0) str += "\n";
        if (i == j) str += ">";
        str += mem[j].toString(16).padStart(2, "0");
        if (j == i) str += " MARK";
        if (j == i+1) str += " TMP2";
        if (j == i+2) str += " TMP";
        if (j == i+3) str += " IDX";
        if (j == i+4) str += " XA";
        if (j == i+5) str += " XB";
        if (j == i+6) str += " XC";
        if (j == i+7) str += " XD";
        str += "\n";
    }
    return str;
}

function wrapNum(n) {
    n %= 256;
    if (n < 0) n += 256;
    return n;
}

async function runBF(bf, getInput, sendOutput) {
    let lastYield = Date.now();

    let parsed = parseBF(bf);

    let mem = [0];
    let i = 0;

    let stack = [parsed];
    let idxs = [0];
    while (stack.length > 0) {
        let current = stack.at(-1);
        let idx = idxs.at(-1);

        if (current.length == idx) {
            let now = Date.now();
            if (now - lastYield > 50) {
                if (isStopRequested) return;
                await idle();
                lastYield = now;
            }
            if (mem[i] == 0 || stack.length == 1) {
                stack.pop();
                idxs.pop();
            } else {
                idxs[idxs.length-1] = 0;
            }
            continue;
        }

        let cmd = current[idx];
        let action = cmd.action;

        idxs[idxs.length-1] = idx+1;

        if (action == "incr") {
            mem[i] = wrapNum(mem[i]+1);
        } else if (action == "decr") {
            mem[i] = wrapNum(mem[i]-1);
        } else if (action == "left") {
            if (i > 0) i--;
        } else if (action == "right") {
            i++;
            while (mem.length <= i) {
                mem.push(0);
            }
        } else if (action == "output") {
            sendOutput(String.fromCharCode(mem[i]));
        } else if (action == "input") {
            let input = await getInput();
            if (input == -1) return;
            mem[i] = input;
            lastYield = Date.now();
        } else if (action == "dump") {
            sendOutput(doDump(mem, i));
        } else if (action == "loop") {
            if (mem[i] != 0) {
                stack.push(cmd.block);
                idxs.push(0);
            }
        }
    }
}

function optimizeTextBF(bf) {
    let emptyEquivalents = [
        "<>", "><", "-+", "+-", 
        /(?<=\])\[[^\[\]]+\]/g, "[]"
    ];
    let changes = true;
    while (changes) {
        changes = false;
        for (let phrase of emptyEquivalents) {
            let newBF = bf.replaceAll(phrase, "");
            if (newBF != bf) changes = true;
            bf = newBF;
        }
    }
    return bf;
}

function getMacros() {
    let result = [];
    for (let macro of document.getElementsByClassName("macro")) {
        result.push({
            name: macro.querySelector(".macro-title").innerText.trim(),
            content: macro.querySelector(".macro-input").value.trim()
        });
    }
    return result;
}

function* getConstants() {
    let constantsTxt = document.getElementById("constants-input").value;
    for (let line of constantsTxt.split("\n")) {
        if (line.startsWith("#") || line == "") continue;
        let groups = /^(\w+)=(\w*)$/.exec(line);
        if (groups == null) {
            sendError("Illegal syntax in constants");
        }
        yield [groups[1], groups[2]];
    }
}

function compileMacro(macros, macroName, arguments) {
    let macro = macros.find(macro => macro.name == macroName);

    if (!macro) {
        sendError(`Macro ${macroName} expected but not found`);
    }

    let txt = macro.content;

    let vars = new Map([
        ...arguments.map((arg, idx) => [idx.toString(), arg]),
        ...getConstants()
    ]);

    txt = txt.replace(/\/\w+\//g, (match) => {
        let name = match.slice(1, -1);
        let val = vars.get(name);
        if (val) {
            return val;
        } else {
            sendError(`no variable named ${name} found`);
        }
    });

    let tokenRules = [
        {re: /^([\[\]\+\-,.<>~])/, name: "bf"},
        {re: /^\ ?{(\d+)\}/, name: "repeat"},
        {re: /^(\w+)(?: ?\(([^\ ),]+(?:, *[^\ ),]+)*)\))?/, name: "macro"},
        {re: /^\s+/, name: "noop"}, // whitespace
        {re: /^#[^#]+#/, name: "noop"} // comment
    ];

    let tokens = [];

    let i = 0;
    while (i < txt.length) {
        let rest = txt.slice(i);
        let match = null;
        let rule = null;
        for (let tokenRule of tokenRules) {
            match = tokenRule.re.exec(rest);
            if (match) {
                rule = tokenRule;
                break;
            }
        }
        if (match == null) {
            sendError("invalid syntax here ->" + txt.slice(i, i + 10));
        }
        i += match[0].length;
        tokens.push({name: rule.name, parts: match.slice(1)});
    }

    let parseRules = [
        {name: "noop", func: (tokens, i) => {
            return {from: i, to: i, replacement: []};
        }},
        {name: "repeat", func: (tokens, i) => {
            if (i < 1) sendError("cannot repeat nothing");
            let repeatee = tokens[i-1];
            let token = tokens[i];
            let count = parseInt(token.parts[0]);
            return {from: i - 1, to: i, replacement: Array(count).fill(repeatee)}
        }},
        {name: "macro", func: (tokens, i) => {
            let token = tokens[i];
            let macroName = token.parts[0];
            let arguments = [];
            let argStr = token.parts[1];
            if (argStr != null) {
                arguments = argStr.split(",").map(arg => arg.trim());
            }
            return {from: i, to: i, replacement: [{
                name: "bf", parts: [compileMacro(macros, macroName, arguments)]
            }]};
        }}
    ];

    outerLoop: while (true) {
        for (let parseRule of parseRules) {
            for (let i in tokens) {
                let token = tokens[i];
                if (token.name != parseRule.name) continue;
                let {from, to, replacement} = parseRule.func(tokens, i);
                tokens.splice(from, to - from + 1, ...replacement);
                continue outerLoop;
            }
        }
        break;
    }

    let result = "";
    for (let token of tokens) {
        if (token.name != "bf") {
            sendError(`Invalid token name in final result: '${token.name}'`);
        }
        result += token.parts[0];
    }
    return result;
}

function addMacro(name=null, content=null) {
    let macro = document.getElementById("macro-template").content.cloneNode(true);
    if (name != null) macro.querySelector(".macro-title").innerText = name;
    if (content != null) macro.querySelector(".macro-input").value = content;
    document.getElementById("macros").appendChild(macro);
}

function loadSave(str) {
    let data = JSON.parse(str);
    for (let macro of data.macros) {
        addMacro(macro.name, macro.content);
    }
    document.getElementById("constants-input").value = data.constants;
}

function saveToStorage() {
    localStorage.setItem("save", JSON.stringify({
        macros: getMacros(),
        constants: document.getElementById("constants-input").value
    }));
}

function getInputChar() {
    const consoleTextElem = document.getElementById("console-text");
    let consoleText = consoleTextElem.value;
    if (consoleText.startsWith(lastInput) && consoleText.length > lastInput.length) {
        let char = consoleText[lastInput.length];
        lastInput = consoleText.slice(0, lastInput.length+1);
        return char.charCodeAt(0);
    } else {
        lastInput = consoleText;
        return null;
    }
}

function sendOutputStr(str) {
    const consoleTextElem = document.getElementById("console-text");
    let consoleText = consoleTextElem.value;
    consoleText += str;
    consoleTextElem.value = consoleText;
    lastInput = consoleText;
}

function sendError(error) {
    sendOutputStr(`\nError: ${error}\n\n`);
    throw new Error(error);
}

function clearConsole() {
    lastInput = "";
    document.getElementById("console-text").value = "";
}

function transpileToBF() {
    try {
        return optimizeTextBF(compileMacro(getMacros(), "program", []));
    } catch (e) {
        return null;
    }
}

async function runCode() {
    saveToStorage();
    if (isRunning) return;
    let bf = transpileToBF();
    if (bf == null) return;
    setIsRunning(true);
    isStopRequested = false;
    clearConsole();
    sendOutputStr("Execution started\n");
    await runBF(bf, async () => {
        while (true) {
            let char = getInputChar();
            if (char != null) return char;
            let {promise, resolve, reject} = Promise.withResolvers();
            onNextInput = resolve;
            cancelExecution = reject;
            try {
                await promise;
            } catch {
                return -1;
            } finally {
                cancelExecution = null;
                onNextInput = null;
            }
        }
    }, sendOutputStr);
    setIsRunning(false);
    sendOutputStr("\nExecution finished\n");
}

function stopCode() {
    if (!isRunning) return;
    if (cancelExecution != null) {
        cancelExecution();
    } else {
        isStopRequested = true;
    }
}

function showCompiled() {
    saveToStorage();
    if (isRunning) return;
    let bf = transpileToBF();
    if (bf == null) return;
    clearConsole();
    sendOutputStr("Compiled output\n");
    sendOutputStr(bf);
}

function exportSave() {
    saveToStorage();
    clearConsole();
    sendOutputStr("Save JSON\n");
    sendOutputStr(localStorage.getItem("save"));
}

function closeImportSave() {
    document.getElementById("import-save-modal").style.display = "none";
    document.getElementById("import-save-input").value = "";
}

function finishImportSave() {
    let save = document.getElementById("import-save-input").value;
    try {
        loadSave(save);
        localStorage.setItem("save", save);
        location.reload();
    } catch (e) {
        clearConsole();
        sendOutputStr("Could not load save\n");
        sendOutputStr(e.toString()+"\n");
    }
    closeImportSave();
}

addEventListener("load", () => {
    let saved = localStorage.getItem("save");
    if (saved == null) {
        addMacro("program", ",.");
    } else {
        loadSave(saved);
    }

    document.getElementById("add-macro").addEventListener("click", () => {
        addMacro();
    });

    const consolePanel = document.getElementById("console-panel");
    consolePanel.addEventListener("click", () => {
        consolePanel.focus();
    });

    document.getElementById("stop-run").addEventListener("click", () => {
        if (isRunning) {
            stopCode();
        } else {
            runCode();
        }
    });

    document.getElementById("save").addEventListener("click", saveToStorage);

    document.getElementById("console-text").addEventListener("input", () => {
        if (onNextInput != null) {
            let resolver = onNextInput;
            onNextInput = null;
            resolver();
        }
    });

    document.getElementById("macros").addEventListener("click", (e) => {
        if (e.target.classList.contains("macro-delete")) {
            let elem = e.target;
            while (!elem.classList.contains("macro")) {
                elem = elem.parentElement;
            }
            elem.remove();
        }
    });

    document.getElementById("console-clear").addEventListener("click", clearConsole);

    document.getElementById("constants-close").addEventListener("click", () => {
        document.getElementById("constants-modal").style.display = "none";
    });

    document.getElementById("constants-open").addEventListener("click", () => {
        document.getElementById("constants-modal").style.display = "flex";
    });

    document.getElementById("show-compiled").addEventListener("click", showCompiled);

    document.getElementById("export-save").addEventListener("click", exportSave);

    document.getElementById("start-import-save").addEventListener("click", () => {
        document.getElementById("import-save-modal").style.display = "flex";
    });

    document.getElementById("cancel-import-save").addEventListener("click", closeImportSave);
    
    document.getElementById("finish-import-save").addEventListener("click", finishImportSave);
});
