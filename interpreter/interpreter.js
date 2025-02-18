const prompt = require('prompt-sync')();
const builtin = require('./builtin');
const converter = require('./infix');
const fs = require('fs')
const path = require("path");

const tokenize = (line) => {
	for (let i = 0 ; i < line.length ; i ++ ) {
		//Ignore and exclude spaces.
		if (line[i] === '=' && line[i+1] !== '=' && line[i-1] !== '=') {
			return [line.slice(0,i), line.slice(i + 1)]
		}
	}
	return ["_",line]
}

const isBoolean = (str) => {
    return str === "true" || str === "false"
}

const isVariableName = (varName) => {
    const regex = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
    const found = varName.match(regex);
    return !isFunctionDef(varName) && !isArray(varName) && !isString(varName) && !isNumeric(varName) && !isBoolean(varName) && !!found && varName === found[0];
}

function* argGenerator (expression) {
    const chunks = converter.splitOnSpaces(expression).filter(c => c !== "");
    for (let i = 0 ; i < chunks.length ; i ++ ) {
        yield chunks[i].replace(/[)}{(]/g, '');
    }
}


const isNumeric = n => !!Number(n) || n === '0';
const isArray = data => {
    return data[0] === '[' && data[data.length - 1] === ']';
}
const isString = data => {
    return data[0] === '"' && data[data.length - 1] === '"';
}

const arraysMatch = (a,b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) {
        return false;
    }
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0 ; i < a.length ; i ++ ) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

const extractVarFromExpr = (expr, globals) => {
    const tokens = converter.splitOnSpaces(expr);
    const v = tokens.filter(t => isVariableName(t)).filter(t => !(t in globals));
    const varCount = new Set(v).size;
    if (varCount === 1) {
        return v[0];
    }
    if (varCount === 0) {
        return '';
    }

    throw "You can't have " + varCount + " variables in a pattern match!"
}


const patternsMatch = (pattern, vars, globals) => {
    if (pattern.length !== vars.length) {
        return false;
    }
    const innerVars = {};
    for (let i = 0 ; i < pattern.length ; i ++ ) {
        if (!isVariableName(pattern[i])) {
            const parsedPattern = parseToForm(pattern[i], vars, "");
            if (isFunctionDef(parsedPattern)) {
                const varName = extractVarFromExpr(parsedPattern, {...globals, ...innerVars});
                const args = {};
                args[varName] = vars[i];
                if (!interpretExpression(parsedPattern, {...args, ...globals, ...innerVars}, true)) {
                    return false;
                }
                innerVars[varName] = vars[i];
            } else if (parsedPattern !== vars[i] && !arraysMatch(parsedPattern, vars[i])) {
                return false;
            }
        } else {
            innerVars[pattern[i]] = vars[i];
        }
    }
    return true;
}


const doFunctionOperation = (func, variables, globals) => {
    if (Array.isArray(func.operation)) {
        let operationList = func.operation;
        operationList.sort((a,b) => {
            const aNonVariablesCount = a.pattern.filter(p => !isVariableName(p)).length;
            const bNonVariablesCount = b.pattern.filter(p => !isVariableName(p)).length;
            if (aNonVariablesCount > bNonVariablesCount) {
                return -1;
            }
            if (aNonVariablesCount < bNonVariablesCount) {
                return 1;
            }
            return 0;
        })
        for (const op of operationList) {
            if (patternsMatch(op.pattern,variables, globals)) {
                const sig = JSON.stringify(variables);
                if (func.memoize && sig in func.cached) {
                    return func.cached[sig];
                }
                const result = op.behavior(variables);
                if (func.memoize) {
                    func.cached[sig] = result;
                }
                return result;
            }
        }
        throw "Non exhaustive pattern match with function: " + func.name;
    }
}

const peeker = iterator => {
    let peeked = iterator.next();
    let rebuiltIterator = function*() {
        if(peeked.done)
            return;
        yield peeked.value;
        yield* iterator;
    }
    return { peeked, rebuiltIterator };
}

const functor = (gen, vars, withData, location) => {
	let arg = gen.next().value;
    arg = parseToForm(arg, vars, location);
	if (arg in builtin.functions) {
		const func = builtin.functions[arg];
		const spreadables = func.arity[0].map(_ => {
            return functor(gen, vars, withData, arg);
        });
		if (func.generated) {
            return doFunctionOperation(func, spreadables, vars);
        }else {
            return func.operation(...spreadables);
        }
    } else {
        if (arg in vars) {
            arg = vars[arg];
        } else  if ("_functionScoped" in vars && arg in vars["_functionScoped"]) {
            arg = vars["_functionScoped"][arg];
        }
        let newSeq;
        switch (arg) {
            case "=":
                newSeq = rebuildUntilClosed(gen);
                vars["_functionScoped"][withData] = interpretExpression(newSeq, vars);
                return vars["_functionScoped"][withData];
            case ";":
                return;
            case "=!":
                newSeq = rebuildUntilClosed(gen);
                vars[withData] = interpretExpression(newSeq, vars);
                return vars[withData];
            case "->":
                newSeq = rebuildUntilClosed(gen);
                if (Array.isArray(withData)) {
                    return withData.map((d,i) => {
                        //Copy withData, changes shouldn't affect everything
                        const newVal = {"@": d,"#": i, "^": withData};
                        return interpretExpression(newSeq, {...vars, ...newVal});
                    })
                } else {
                    const newVal = {"@": withData, "#": 0};
                    return interpretExpression(newSeq, {...vars, ...newVal});
                }
            case "\\>":
                const acc = interpretExpression(rebuildUntilClosed(gen),vars);
                newSeq = rebuildUntilClosed(gen);
                return withData.reduce((acc, v, idx) => {
                    const newVal = {"@": v,"$": acc, "#": idx, "^": withData};
                    return interpretExpression(newSeq, {...vars, ...newVal});
                }, acc);
            case "~>":
                newSeq = rebuildUntilClosed(gen);
                return withData.filter((item, idx) => {
                    const newVal = {"@": item,"#": idx, "^": withData};
                    return interpretExpression(newSeq, {...vars, ...newVal});
                });
            default:
                return arg;
        }
	}
}

const rebuildUntilClosed = (gen) => {
    const arg = gen.next().value;
    if (arg in builtin.functions) {
        const func = builtin.functions[arg];
        return arg + " " + func.arity[0].map(_ => rebuildUntilClosed(gen)).join(" ");
    }
    return arg;
}

const isFunctionDef = (token) => {
    return typeof token === "string" && token.includes(" ");
}

const generateFunction = (token, action, vars) => {
    const firstSpace = token.indexOf(' ');
    const funcName = token.slice(0,firstSpace);
    const rest = converter.infixToPrefix(token.slice(firstSpace + 1));
    const assignArgs = [];
    let section;
    const gen = argGenerator(rest);
    while (section = rebuildUntilClosed(gen)) {
        if (section === '') {
            break;
        }
        assignArgs.push(section);
    }
    const notMemo = funcName.startsWith("@i_");
    const fmtFuncName = notMemo ? funcName.slice(3) : funcName;
    //Define a list of functions to perform based on supplied args pattern match.
    if (!(fmtFuncName in builtin.functions)) {
        builtin.functions[fmtFuncName] = {
            arity: [assignArgs.map(_=>0),[0]],
            operation: [],
            generated: true,
            name: fmtFuncName,
            memoize: !notMemo,
            cached: {}
        }
    }
    builtin.functions[fmtFuncName].operation.push({
            pattern: assignArgs,
            behavior: (supplied) => {

                const suppliedMap = {};
                const innerVars = {};
                for (let i = 0 ; i < assignArgs.length ; i ++ ) {
                    const varName = extractVarFromExpr(assignArgs[i], {...vars, ...innerVars});
                    suppliedMap[varName] = supplied[i];
                    innerVars[varName] = supplied[i];
                }
                return interpretExpression(action, {...vars, ...suppliedMap});
            }
        }
    )
}

const splitFirstAndRest = (str) => {
    const sep = str.indexOf(" ");
    if (sep === -1) {
        return [str,""];
    }
    return [str.slice(0,sep), str.slice(sep + 1)];
}

const interpretExpression = (expr, vars) => {
    const firstAndLast = splitFirstAndRest(expr);
    if (firstAndLast[0] === "import") {
        loadFile(firstAndLast[1].endsWith(".fv") ? firstAndLast[1] : firstAndLast[1] + ".fv",vars);
        return;
    }
    let gen = argGenerator(expr, vars);
    let pointFreeArg = undefined;
    let streamFinished = false;
    while (!streamFinished) {
        pointFreeArg = functor(gen, vars, pointFreeArg, "");
        const remaining = peeker(gen);
        if (remaining.peeked.done) {
            streamFinished = true;
        } else {
            gen = remaining.rebuiltIterator();
        }
    }
    return pointFreeArg;
}

const interpretLine = (line,vars,suppressOutput) => {
    if (line.length === 0 || lineIsComment(line)) {
        return vars;
    }
	const tokens = tokenize(line).map(token=>token.trim());
    const converted = converter.infixToPrefix(tokens[1]);
    if (isFunctionDef(tokens[0])) {
	    generateFunction(tokens[0], converted, vars);
        return [vars, undefined];
    } else {
        let result;
        try {
            result = interpretExpression(converted, vars);
        } catch (error) {
            console.log(error)
            return [vars, result];
        }
        if (suppressOutput || result === undefined || result === null) {
            ;
        } else {
            console.log(result);
        }
        if (tokens[0] !== '_') {
            vars[tokens[0]] = result;
        }
        vars["_functionScoped"] = {};
        return [vars, result];
    }
}
const lineIsComment = (line) => {
    return line[0] === '/';
}
const loadFile = (inputFile, vars) => {
    const inputPath = path.resolve(inputFile);
    if (!fs.existsSync(inputPath)) {
        console.error("No such input file: " + inputPath);
        process.exit(1);
    }
    const file = fs.readFileSync(inputPath,'utf8');
    provideInterpreterFunctions();
    file.split("\n").forEach(line => interpretLine(line, vars,true));
}

const isArrayIndex = (str) => {
    const match = /.+\[.+]/g;



}

const parseToRange = (arr, vars) => {
    const match = /\[.+\.\..*]/g;
    const result = arr.match(match);
    if (result) {
        const tokens = arr.slice(1,arr.length - 1).split("..");
        const t1 = tokens[0];
        const t2 = tokens[1];
        const t1Res = interpretExpression(t1, vars);
        const t2Res = interpretExpression(t2, vars);
        let result;
        if (t1Res < t2Res) {
            result = new Array(t2Res - t1Res);
            for (let i = t1Res ; i <= t2Res ; i ++ ) {
                result[i - t1Res] = i;
            }
        } else {
            result = new Array(t1Res - t2Res);
            for (let i = t1Res ; i >= t2Res ; i -- ) {
                result[t1Res - i] = i;
            }
        }
        return result;
    }
    const members = arr.slice(1,arr.length - 1).split(",").filter(m => m !== " " && m !== "");
    return members.map(m => parseToForm(m), vars);
}

//Doesn't support nested arrays.
const parseToForm = (data, vars, location) => {
    if (data === undefined) {
        throw "Incomplete statement!  Function " + location + " is missing arguments."
    }
    if (data === "true") {
        return true;
    }
    if (data === "false") {
        return false;
    }
    if (isString(data)) {
        return data.slice(1,data.length - 1);
    } else if (isNumeric(data)) {
        return Number(data);
    } else if (isArray(data)) {
        return parseToRange(data, vars);

    }
    return data
}

const interactive = (withVars) => {
    let vars = withVars || createVars();
    provideInterpreterFunctions();
    while (true) {
        const line = prompt('>');
        if (line == null) {
            return;
        }
        vars = interpretLine(line,vars, false)[0];
    }
}

const provideInterpreterFunctions = () => {
    builtin.functions["take"] = {
        arity: [[0],[0]],
        operation: (prmpt) => prompt(prmpt),
        generated: false
    }

    builtin.functions["cast"] = {
        arity: [[0],[0]],
        operation: (string) => parseToForm(string,{}),
        generated: false
    }
}

const createVars = () => {
    return {"_functionScoped": {}};
}


module.exports = {
    provideInterpreterFunctions,
    interactive,
    interpretLine,
    interpretExpression,
    arraysMatch,
    createVars,
    loadFile
}
