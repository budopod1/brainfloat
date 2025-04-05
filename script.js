let lastInput = "";
let onNextInput = null;
let cancelExecution = null;
let isRunning = false;
let isStopRequested = false;

function sendOutputStr(str) {
    const consoleTextElem = document.getElementById("console-text");
    let consoleText = consoleTextElem.value;
    consoleText += str;
    consoleTextElem.value = consoleText;
    lastInput = consoleText;
}

function showError(error) {
    sendOutputStr(error+"\n");
}

function setIsRunning(running) {
    document.getElementById("stop-run").innerText = running ? "Stop" : "Run";
    isRunning = running;
}

function outputDump(mem, i) {
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
    sendOutputStr(str);
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

function getConstants() {
    return parseConstants(
        document.getElementById("constants-input").value
    );
}

function checkInputChar() {
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

function clearConsole() {
    lastInput = "";
    document.getElementById("console-text").value = "";
}

async function getInputChar() {
    while (true) {
        let char = checkInputChar();
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
}

function getEnv() {
    return {
        macros: getMacros(),
        constants: getConstants(),
        onStart: () => {
            setIsRunning(true);
            isStopRequested = false;
            clearConsole();
            sendOutputStr("Execution started\n");
        },
        isStopRequested: () => isStopRequested,
        sendOutput: sendOutputStr,
        getInput: getInputChar,
        outputDump
    };
}

async function runCode() {
    saveToStorage();

    try {
        await runEnv(getEnv());
        sendOutputStr("\nExecution finished\n");
    } catch (e) {
        showError(e);
    }

    setIsRunning(false);
}

function showCompiled() {
    saveToStorage();
    if (isRunning) return;

    let bf;
    try {
        bf = getEnvBF(getEnv());
    } catch (e) {
        showError(e);
        return;
    }
    
    clearConsole();
    sendOutputStr("Compiled output\n");
    sendOutputStr(bf);
}

function stopCode() {
    if (!isRunning) return;
    if (cancelExecution != null) {
        cancelExecution();
    } else {
        isStopRequested = true;
    }
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
