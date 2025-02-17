/* Fetch addresses from OpenAddresses and check for each Postal Code the corresponding GPS
   coordinates and calculate a center and polygon for each said Postal Code.
   File from OpenAddresses available on:
   https://github.com/openaddresses/openaddresses/blob/master/sources/pt/countrywide.json */

const fs = require('fs')
const path = require('path')
const extract = require('extract-zip')
const async = require('async')
const ProgressBar = require('progress')
const colors = require('colors/safe')
const csv = require('csvtojson')
const commandLineArgs = require('command-line-args')
const debug = require('debug')('geoapipt:generate-postal-codes')

const downloadZipMod = require(path.join(__dirname, 'downloadZip.js'))
const preparePostalCodesCTTMod = require(path.join(__dirname, 'prepareCTTfile.js'))
const generatePostalCodesFunctions = require(path.join(__dirname, 'functions.js'))

const resDirectory = path.join(__dirname, '..', '..', '..', 'res', 'postal-codes')

let openAddressesZipFilePath
const unzippedFilesEncoding = 'utf8' // see https://stackoverflow.com/a/14551669/1243247
let unzippedFilePath

let cttData = [] // data fetched from CTT file
let postalCodes = [] // array with CP4-CP3 postal codes (no duplications)
let CP4postalCodes = [] // array with only CP4 postal codes (no duplications)
const openAddressesData = [] // data fetched from OpenAddresses file
let numberOfEntriesOpenAddresses

const functionExecution =
  [
    downloadZip, // downloads zip file from OpenAddresses
    extractZip, // extracts zip file from OpenAddresses
    countFileLines, // number of lines of CSV file corresponds to the number of entries
    parseCsvFiles, // parse CSV file from OpenAddresses and store it in openAddressesData
    deleteZipFile, // deletes zip file from OpenAddresses
    preparePostalCodesCTT, // parse files from CTT and stores data in cttData
    assembleCP3Data, // process and assemble data from both databases (OpenAddresses and CTT) to generate CP3 JSON files
    assembleCP4Data // process and assemble data from both databases (OpenAddresses and CTT) to generate CP4 JSON files
  ]

// ex: node js/generatePostalCodes.js download-zip
// downloads ZIP from OpenAddresses
const argvOptions = commandLineArgs([
  { name: 'download-zip', type: Boolean },
  { name: 'onlyCP4', type: String, multiple: true },
  { name: 'onlyCP3', type: Boolean }
])

async.series(
  functionExecution,
  function (err) {
    if (err) {
      console.error(err)
      process.exitCode = 1
    } else {
      console.log(`Postal Codes JSON files generated with ${colors.green.bold('success')}`)
    }
  })

function downloadZip (callback) {
  downloadZipMod(argvOptions['download-zip'], (err, res) => {
    if (err) {
      callback(Error(err))
    } else {
      openAddressesZipFilePath = res
      callback()
    }
  })
}

// extracts zip file from OpenAddresses
function extractZip (callback) {
  console.log(`extracting ${openAddressesZipFilePath}`)
  extract(openAddressesZipFilePath, {
    dir: resDirectory,
    onEntry: (entry, zipfile) => {
      unzippedFilePath = path.join(resDirectory, entry.fileName)
    }
  }).then(() => {
    console.log(`extraction complete to ${unzippedFilePath}`)
    callback()
  }).catch((errOnUnzip) => {
    callback(Error('Error unziping file ' + openAddressesZipFilePath + '. ' + errOnUnzip.message))
  })
}

// number of lines of CSV file corresponds to the number of entries
function countFileLines (callback) {
  let lineCount = 0
  fs.createReadStream(unzippedFilePath)
    .on('data', (buffer) => {
      let idx = -1
      lineCount-- // Because the loop will run once for idx=-1
      do {
        idx = buffer.indexOf(10, idx + 1)
        lineCount++
      } while (idx !== -1)
    }).on('end', () => {
      numberOfEntriesOpenAddresses = lineCount
      console.log(`CSV file from OpenAddresses has ${numberOfEntriesOpenAddresses} entries`)
      callback()
    }).on('error', (err) => {
      callback(Error(err))
    })
}

function parseCsvFiles (callback) {
  console.log('Parsing CSV file from OpenAddresses')
  const bar = new ProgressBar('[:bar] :percent', { total: numberOfEntriesOpenAddresses - 1, width: 80 })
  csv({
    delimiter: ','
  })
    .fromStream(fs.createReadStream(unzippedFilePath, { encoding: unzippedFilesEncoding }))
    .subscribe((json) => {
      bar.tick()
      if (Array.isArray(json)) { // json is array
        openAddressesData.push(...json)
      } else { // json is element
        openAddressesData.push(json)
      }
    },
    (err) => {
      bar.terminate()
      callback(Error(err))
    },
    () => {
      bar.terminate()
      console.log('Extracted CSV data from ' + unzippedFilePath)
      callback()
    })
}

function deleteZipFile (callback) {
  if (fs.existsSync(unzippedFilePath)) {
    fs.unlinkSync(unzippedFilePath)
  }
  console.log('Extracted CSF file deleted after being processed')
  callback()
}

function preparePostalCodesCTT (callback) {
  preparePostalCodesCTTMod.prepare((err, data) => {
    if (err) {
      callback(Error(err))
    } else {
      cttData = data
      postalCodes = removeDuplicatesFromArray(cttData.map(el => el.CP))
      console.log(`Found ${postalCodes.length} different CP4-CP3 postal codes in CTT file`)
      CP4postalCodes = removeDuplicatesFromArray(cttData.map(el => el.CP4))
      console.log(`Found ${CP4postalCodes.length} different CP4 postal codes in CTT file`)
      callback()
    }
  })
}

// process and assemble data from both databases (OpenAddresses and CTT) to generate CP3 JSON files
function assembleCP3Data (callback) {
  if (argvOptions.onlyCP4) {
    callback()
    return
  }

  // for tests, just get first N entries, i.e., trim array
  // postalCodes = postalCodes.slice(0, 100)

  // data directory where all CP4/CP3.json will be stored
  if (!fs.existsSync(path.join(resDirectory, 'data'))) {
    fs.mkdirSync(path.join(resDirectory, 'data'))
  }

  console.log(`Creating ${CP4postalCodes.length} directories for postal codes, each directory for each CP4`)
  const barDirectories = new ProgressBar('[:bar] :percent :info', { total: CP4postalCodes.length, width: 80 })
  for (const CP4 of CP4postalCodes) {
    if (!fs.existsSync(path.join(resDirectory, 'data', CP4))) {
      fs.mkdirSync(path.join(resDirectory, 'data', CP4), { recursive: true })
      barDirectories.tick({ info: `${path.join('res', 'postal-codes', 'data', CP4)} created` })
    } else {
      barDirectories.tick({ info: `${path.join('res', 'postal-codes', 'data', CP4)} already exists` })
    }
  }
  barDirectories.terminate()

  console.log('Process and assemble CP4-CP3 Postal Codes data from both databases (OpenAddresses and CTT)')

  let bar
  if (!debug.enabled) {
    bar = new ProgressBar('[:bar] :percent :info', { total: postalCodes.length + 1, width: 80 })
  } else {
    bar = { tick: () => {}, terminate: () => {} }
  }

  bar.tick({ info: 'Beginning' })

  async.each(postalCodes, function (postalCode, callback) {
    bar.tick({ info: postalCode })
    generatePostalCodesFunctions.createCP4CP3jsonFile(resDirectory, postalCode, cttData, openAddressesData, callback)
  },
  function (err) {
    bar.terminate()
    if (err) {
      callback(Error(err))
    } else {
      console.log('All CP4-CP3 JSON files have been created successfully')
      callback()
    }
  })
}

// process and assemble data from both databases (OpenAddresses and CTT) to generate CP4 JSON files
function assembleCP4Data (callback) {
  if (argvOptions.onlyCP3) {
    callback()
    return
  }

  console.log('Process and assemble CP4 Postal Codes data from both databases (OpenAddresses and CTT)')
  if (argvOptions.onlyCP4.length) {
    CP4postalCodes = argvOptions.onlyCP4
    console.log('only these CP4: ', CP4postalCodes)
  }

  let bar
  if (!debug.enabled) {
    bar = new ProgressBar('[:bar] :percent :info', { total: CP4postalCodes.length * 2 + 1, width: 80 })
  } else {
    bar = { tick: () => {}, terminate: () => {} }
  }

  bar.tick({ info: 'Beginning' })

  async.each(CP4postalCodes, function (CP4postalCode, callback) {
    bar.tick({ info: CP4postalCode })
    generatePostalCodesFunctions.createCP4jsonFile(resDirectory, CP4postalCode, cttData, openAddressesData,
      (err) => {
        bar.tick({ info: CP4postalCode })
        if (err) callback(Error(err))
        else callback()
      })
  },
  function (err) {
    bar.terminate()
    if (err) {
      callback(Error(err))
    } else {
      console.log('All CP4 JSON files have been created successfully')
      callback()
    }
  })
}

function removeDuplicatesFromArray (array) {
  return [...new Set(array)]
}
