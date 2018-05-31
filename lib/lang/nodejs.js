/*
 * Copyright 2018 IBM Corporation
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

const debug = require('debug')('composer.nodejs')
debug('loading')

//const usage = require('./usage')
const path = require('path')
const expandHomeDir = require('expand-home-dir')
const requireUncached = require('require-uncached')
const openwhiskComposer = require('@ibm-functions/composer')
const { isValidFSM } = require('../composer')

// command aliases
const aliases = ['js', 'nodejs', 'json']

// help compositions find our @ibm-functions/composer module
require('app-module-path').addPath(path.join(__dirname, '../../node_modules'))
require('app-module-path').addPath(path.join(__dirname, '../../../../node_modules'))

/**
 * Initialize nodejs support
 *
 */
const init = () => {
    // no-op
    return true
}

/**
  * Clean up nodejs support
  *
  */
const clean = () => {
    // no-op
    return true
}

/**
  * take source program to IR
  *
  */
const compose = (_1, _2, _3, _4, _5, { parameters }, args, options) => new Promise((resolve, reject) => {
    debug('compose', parameters)

    try {
        const { localCodePath, filename, dir, source:originalCode, opts } = parameters
        const sandbox = {}

        if (originalCode.trim().length === 0) {
            // no code, yet!
            return reject({ message: 'No code to compile', type: 'EMPTY_FILE'})
        }

        let errorMessage = '',
            logMessage = ''     // TODO this isn't flowing through, yet
        const errors = []
        const compile = code => {
            errorMessage = ''
            logMessage = ''
            try {
                // we'll override these temporarily
                const log = console.log
                const err = console.error
                const exit = process.exit

                const my = {
                    process: {
                        exit: () => reject({
                            statusCode: 'ENOPARSE',
                            fsm: errorMessage,
                            code: originalCode
                        })
                    },
                    console: {
                        error: function() {
                            err(...arguments)
                            for (let idx = 0; idx < arguments.length; idx++) {
                                errorMessage += arguments[idx].toString() + ' '
                            }
                            errorMessage += '\n'
                        },
                        log: msg => {
                            logMessage += msg + '\n'
                        }
                    }
                }

                let res
                try {
                    // Note the use of requireUncached: this allows
                    // users to edit and see updates of their
                    // compositions, without having to reload or
                    // restart the shell
                    const modulePath = path.resolve(ui.findFile(expandHomeDir(localCodePath)))
                    debug('using require to process composition', modulePath)

                    // temporarily override (restored in the finally block)
                    console.log = my.console.log
                    console.error = my.console.error
                    process.exit = my.process.exit

                    res = requireUncached(modulePath)
                } finally {
                    // restore our temporary overrides
                    console.log = log
                    console.error = err
                    process.exit = exit

                    if (logMessage) {
                        console.log(logMessage)
                    }
                    if (errorMessage) {
                        console.error(errorMessage)
                    }
                }

                debug('res', typeof res, res)

                if (res.main && isValidFSM(res.main) || typeof res.main === 'function') {
                    debug('pulling composition from exports.main')
                    res = res.main

                } else if (res.composition && isValidFSM(res.composition) || typeof res.composition === 'function') {
                    debug('pulling composition from exports.composition')
                    res = res.composition
                }

                if (typeof res === 'function') {
                    debug('composition is function; evaluating it')
                    res = res()
                }

                if (isValidFSM(res)) {
                    return res

                } else {
                    let err = ''
                    try {
                        // maybe the code did a console.log?
                        const maybeStr = logMessage.substring(logMessage.indexOf('{'), logMessage.lastIndexOf('}') + 1)
                        debug('maybe composition is in log message?', maybeStr)
                        const maybe = openwhiskComposer.util.deserialize(JSON.parse(maybeStr))
                        if (isValidFSM(maybe)) {
                            debug('yes, found composition in log mesasge', maybe)
                            return maybe
                        }
                    } catch (e) {
                        // console.error('could not parse composition from stdout', e)
                        err = e
                    }

                    throw new Error(`Unable to compile your composition
${err}
${errorMessage}`)
                }
            } catch (err) {
                const junkMatch = err.stack.match(/\s+at Object\.exports\.runInNewContext/)
                      || err.stack.match(/\s+at Object\.runInNewContext/)
                      || err.stack.match(/\s+at fs\.readFile/),
                      _message = err.message.indexOf('Invalid argument to compile') >= 0? 'Your source code did not produce a valid app.' : (!junkMatch ? err.stack : err.stack.substring(0, junkMatch.index).replace(/\s+.*create-from-source([^\n])*/g, '\n').replace(/(evalmachine.<anonymous>)/g, filename).replace(/\s+at createScript([^\n])*/g, '\n').trim()),
                      message = _message
                      .replace(/\s+\(.*plugins\/modules\/composer\/node_modules\/@ibm-functions\/composer\/composer\.js:[^\s]*/, '')
                      .replace(/\s+at ContextifyScript[^\n]*/g, '')


                // for parse error, error message is shown in the fsm (JSON) tab, and user code in the source (code) tab
                // reject now returns {fsm:errMsg, code:originalCode}
                return {
                    statusCode: 'ENOPARSE',  // would like to use code here, but we've already used it for code:originalCode
                    message,
                    fsm: message,
                    code: originalCode
                }
            }
        }
        try {
            resolve(compile(originalCode))
        } catch (err) {
            console.error('Catastrophic internal error compiling source')
            console.error(err)
            reject(err)
        }

    } catch (err) {
        console.error(err)
        reject('Internal error compiling your application source code')
    }
})

/**
  * encode as an action
  *
  */
const encode = (_1, _2, _3, _4, _5, { parameters }, args, options) => {
    // app name
    const name = args[0]

    debug('encode', name, parameters)

    return openwhiskComposer.util.encode(name, parameters.composition, '0.4.0')
}

/**
 * The module
 *
 */
module.exports = (commandTree, prequire) => {
    debug('initializing')

    aliases.forEach(lang => {
        commandTree.listen(`/app/lang/${lang}/init/impl`, init)
        commandTree.listen(`/app/lang/${lang}/clean/impl`, clean)
        commandTree.listen(`/app/lang/${lang}/compose/impl`, compose)
        commandTree.listen(`/app/lang/${lang}/encode/impl`, encode)
    })
}
