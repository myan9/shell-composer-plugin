/*
 * Copyright 2017 IBM Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('composer compilation')

const fs = require('fs'),
      path = require('path'),
      expandHomeDir = require('expand-home-dir'),
      openwhiskComposer = require('@ibm-functions/composer'),
      { isValidFSM } = require('./composer')

//
// just in case, block any use of wsk from within sandboxed compilations
//
const nope = {
    create: () => true,
    update: () => true,
    invoke: () => true
}
openwhiskComposer.wsk = {
    actions: nope,
    packages: nope,
    rules: nope,
    triggers: nope
}

const patterns = {
    require: /(const [^\s]+)\s*=\s*require\('@ibm-functions\/composer'\)/,
    constAppEquals: /.*const ([^\s]+)\s*=\s+composer(.*)/,
    return: /^return\s+/
}

/** override values in A with those from B, returning any overwritten values */
const save = (A, B) => {
    const overwritten = {}
    for (let key in B) {
        overwritten[key] = A[key]
        A[key] = B[key]
    }
    return overwritten
}

/** restore values to A using values from B */
const restore = (A, B) => {
    for (let key in B) {
        if (B[key]) {
            A[key] = B[key]
        }
    }
}

/**
 * Take as input a file on disk that makes use of the
 * openwhisk-composer library, and return the corresponding FSM.
 *
 */
exports.compileToFSM = {}

/**
 * Compile a composition to the intermediate representation
 *
 */
exports.compileToFSM = (src, lang='js', opts={}) => new Promise((resolve, reject) => {
    const localCodePath = expandHomeDir(src)

    fs.readFile(ui.findFile(localCodePath), (err, data) => {
        if (err) {
            reject(err)
        } else {
            const filename = path.basename(src),
                  dir = path.dirname(src)

            // source code
            // pass the source code programmatically, not via command line (TODO use param-file?)
            const source = data.toString()
            const parameters = { source, filename, localCodePath, dir, opts }

            // we delegate to the "app lang compile" impl
            debug('compileToFSM', parameters)
            return repl.qexec(`app lang ${lang} compose impl`, undefined, undefined, { parameters })
                .then(finishCompile(opts, source, localCodePath, resolve, reject))
                .catch(reject)
        }
    })
})

/**
 * Common code across languages for validating a compiled FSM and returning to caller
 *
 */
const finishCompile = (opts, code, localCodePath, resolve, reject) => fsm => {
    if (!isValidFSM(fsm)) {
        // still no luck? reject
        console.error('Error compiling app source', fsm)
        if (fsm && fsm.statusCode) {
            debug('rejecting with pre-made error')
            reject(fsm)
        } else {
            reject('Your code could not be composed')
        }

    } else {
        if (opts.code) {
            resolve({fsm, code, localCodePath})
        } else {
            resolve(fsm)
        }
    }
}

/**
 * Fetch a JSON file from the local filesystem
 *
 */
const readJSONFromDisk = location => {
    try {
        const absolute = ui.findFile(expandHomeDir(location)),
              bits = fs.readFileSync(absolute).toString()

        return JSON.parse(bits)
    } catch (e) {
        console.error(e)
        throw new Error('The specified file does not exist')
    }
}

/**
 * Deserialize an FSM
 *
 */
exports.deserializeFSM = fsm => openwhiskComposer.util.deserialize(fsm)

/**
 * Assemble the FSM JSON. It might be on disk, if `fsm` names a file
 * on the local filesystem.
 *
 */
exports.readFSMFromDisk = fsm => {
    if (fsm) {
        return exports.deserializeFSM(readJSONFromDisk(fsm))
    } else {
        return fsm
    }
}

/**
 * A command handler form of compileToFSM
 *
 */
/*const compileToFSMCommand = cmd => (_1, _2, _a, _3, fullCommand, execOptions, args, options) => {
    const idx = args.indexOf(cmd),
          src = args[idx + 1]

    if (!src || options.help) {
        reject(usage(cmd))
    } else {
        return exports.compileToFSM(src)
    }
}*/
    
/*commandTree.listen(`/wsk/app/compose`,
  doIt('compose'),
  { docs: 'Generate the low-level code from a source file. [Note: this is for debugging; consider using "app create" for normal use]' }))
*/
