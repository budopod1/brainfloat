const DEFAULT_CELL_SIZE = 256;
const DEFAULT_IDLE_INTERVAL = -1;

class BFParseError extends Error {}

class BFloatParseError extends Error {}

async function idle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function parseBF(bf) {
    let result = [];
    let stack = [result];
    for (let char of bf) {
        let frame = stack.at(-1);

        let basicOpMap = {
            "+": "incr",
            "-": "decr",
            "<": "left",
            ">": "right",
            ".": "output",
            ",": "input",
            "~": "dump"
        };

        if (char in basicOpMap) {
            frame.push({action: basicOpMap[char]});
        } else if (char == "[") {
            let block = [];
            frame.push({action: "loop", block});
            stack.push(block);
        } else if (char == "]") {
            stack.pop();
            if (stack.length == 0) {
                throw new BFParseError("Unmatched close bracket");
            }
        }
    }
    if (stack.length > 1) {
        throw new BFParseError("Unmatched open bracket");
    }
    return result;
}

function getWrapNumFn(env) {
    let cellSize = env.cellSize || DEFAULT_CELL_SIZE;
    if (cellSize == -1) return n => n;
    if (cellSize == 256) return n => n & 0xFF;
    return n => {
        n %= cellSize;
        return n < 0 ? n + cellSize : n;
    };
}

async function executeParsedBF(env, parsed) {
    env.onStart?.(parsed);

    let lastIdle = Date.now();

    let mem = [0];
    let i = 0;

    let stack = [parsed];
    let idxs = [0]; // the indices in the stack frames

    let wrapNum = getWrapNumFn(env);

    while (stack.length > 0) {
        let frame = stack.at(-1);
        let idx = idxs.at(-1);

        if (frame.length == idx) { // we're at the end of the loop
            let now = Date.now();
            let idleInterval = (env.idleInterval
                || DEFAULT_IDLE_INTERVAL);
            if (idleInterval != -1 && now - lastIdle > idleInterval) {
                if (env.isStopRequested?.()) return;
                await idle();
                lastIdle = now;
            }

            if (mem[i] == 0 || stack.length == 1) {
                stack.pop();
                idxs.pop();
            } else {
                idxs[idxs.length-1] = 0;
            }

            continue;
        }

        let cmd = frame[idx];
        let action = cmd.action;

        idxs[idxs.length-1] = idx+1;

        switch (action) {
        case "incr":
            mem[i] = wrapNum(mem[i]+1);
            break;
        case "decr":
            mem[i] = wrapNum(mem[i]-1);
            break;
        case "left":
            if (i > 0) i--;
            break;
        case "right":
            i++;
            if (mem.length <= i) {
                mem.push(0);
            }
            break;
        case "output":
            env.sendOutput?.(mem[i]);
            break;
        case "input":
            let input;
            if (env.getInput) {
                input = await env.getInput();
            } else {
                input = 0;
            }
            if (input == -1) return;
            mem[i] = wrapNum(input);
            lastIdle = Date.now();
            break;
        case "dump":
            env.ouputDump?.(mem, i);
            break;
        case "loop":
            if (mem[i] != 0) {
                stack.push(cmd.block);
                idxs.push(0);
            }
            break;
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

function runBF(env, bf) {
    return executeParsedBF(env, parseBF(bf));
}

function parseConstants(txt) {
    let result = new Map();
    for (let line of txt.split("\n")) {
        line = line.trim();
        if (line.length == 0 || line[0] == "#") continue;
        let groups = /^(\w+)=(\w*)$/.exec(line);
        if (groups == null) {
            throw new BFloatParseError("Illegal syntax in constants");
        }
        result.set(groups[1], groups[2]);
    }
    return result;
}

function compileMacro(env, macroName, arguments) {
    let macro = env.macros.find(macro => macro.name == macroName);

    if (!macro) {
        throw new BFloatParseError(`Macro ${macroName} expected but not found`);
    }

    function sendError(msg) {
        throw new BFloatParseError(`In macro ${macroName}: ${msg}`);
    }

    let txt = macro.content;

    let varsArr = arguments.map((arg, idx) => [idx.toString(), arg]);
    if (env.constants) {
        varsArr.push(...env.constants);
    }
    let vars = new Map(varsArr);

    txt = txt.replace(/\/\w+\//g, match => {
        let name = match.slice(1, -1);
        let val = vars.get(name);
        if (!val) {
            sendError(`No variable named ${name} found`);
        }
        return val;
    });

    let tokenRules = [
        {re: /^([\[\]\+\-,.<>~])/, name: "bf"},
        {re: /^\ ?\{(\d+)\}/, name: "repeat"},
        {re: /^(\w+)(?: ?\(([^\ ),]+(?:, *[^\ ),]+)*)\))?/, name: "macro"},
        {re: /^\s+/, name: "noop"}, // whitespace
        {re: /^#[^#]*#/, name: "noop"} // comment
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
            let exerpt = txt.slice(i, i + 10);
            sendError("Invalid syntax here ->" + exerpt);
        }

        i += match[0].length;
        if (rule.name == "noop") continue;
        tokens.push({name: rule.name, parts: match.slice(1)});
    }

    let parseRules = [
        {name: "repeat", func: (tokens, i) => {
            if (i < 1) {
                sendError("Can't repeat nothing");
            }
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
                name: "bf", parts: [compileMacro(env, macroName, arguments)]
            }]};
        }}
    ];

    outerLoop: while (true) {
        for (let parseRule of parseRules) {
            for (let i = 0; i < tokens.length; i++) {
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
            sendError("Unmatched "+token.name);
        }
        result += token.parts[0];
    }
    return result;
}

function getEnvBF(env) {
    let compiled = compileMacro(env, "program", []);
    env.onCompiled?.(compiled);
    let optimized = optimizeTextBF(compiled);
    env.onOptimized?.(optimized);
    return optimized;
}

function runEnv(env) {
    return runBF(env, getEnvBF(env));
}

try {
    module.exports = {
        parseConstants, getEnvBF, runEnv, runBF
    };
} catch {}
