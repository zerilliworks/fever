#! /usr/bin/env node

const argv = require('minimist')(process.argv.slice(2));

// Show help text if requested
if (argv.h || argv.help) {
    console.log(
        `Usage: ${process.argv[1]} [options] [ script.fv ]

Options:
    -h, --help                          show this help text
    -i, --interactive                   enter the REPL on startup
    -t, --test                          run the test file
`)

    process.exit(0)
}

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const interpreter = require('./interpreter');
const test = require('./test');

// Create a vars object to hold runtime context
const vars = interpreter.createVars();

console.log("CHANGES ARE REFLECTED IN NPX")

try {
    let inputFile = argv._[0];
    if (inputFile) { // Handle a file path as the zeroth argument
        const inputPath = path.resolve(inputFile);
        if (!fs.existsSync(inputPath)) {
            console.error("No such input file: " + inputPath);
            process.exit(1);
        }
        const file = fs.createReadStream(inputPath);
        const rl = readline.createInterface({input: file});
        rl.on('line', (line) => {
            interpreter.interpretLine(line, vars);
        })
    }

    if (argv.t) {
        test.runTests();
    } else if (!inputFile || argv.i || argv.interactive) {
        // Enter interactive mode if no input file, or the interactive flag is set
        interpreter.interactive(vars)
    }


} catch (e) {
    console.error(e);
    process.exit(1);
}

process.exit(0);