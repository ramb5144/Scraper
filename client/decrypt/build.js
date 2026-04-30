#!/usr/bin/env node
/**
 * Build script for decrypt-interceptor.js
 * Concatenates modular source files into a single IIFE-wrapped file.
 *
 * Usage: node client/decrypt/build.js
 *
 * Module order (dependencies flow downward):
 *   1. config.js    - encryptionConfig, API helpers (required by all)
 *   2. copy.js      - Copy interception, context menu, encryptSearchQuery
 *   3. position.js  - Position mapping, DOM walking, buildTextPositionMap
 *   4. search.js    - Search overlay, highlighting, navigation
 *   5. selection.js - Word/paragraph selection, exposed window functions
 *   6. init.js      - Debug logging, debugEncryption helper
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const OUTPUT_PATH = path.join(__dirname, '..', 'decrypt-interceptor.js');
const VALIDATE_PATH = path.join(__dirname, 'validate.js');

// Modules in dependency order
const MODULES = [
    'config.js',
    'copy.js',
    'position.js',
    'search.js',
    'selection.js',
    'init.js'
];

// Section headers for navigation
const SECTION_NAMES = {
    'config.js': 'CONFIG',
    'copy.js': 'COPY INTERCEPTION',
    'position.js': 'POSITION MAPPING',
    'search.js': 'SEARCH',
    'selection.js': 'SELECTION',
    'init.js': 'INITIALIZATION'
};

const HEADER_COMMENT = `/**
 * Decryption Interceptor for Server-Side Encrypted Pages
 * Provides copy-paste interception and search functionality for pages encrypted server-side
 *
 * Requires window.encryptionConfig to be set before this script loads:
 * window.encryptionConfig = {
 *     hash: 'abc123...',  // Hash of nonce+secret_key (preferred)
 *     OR (for backward compatibility):
 *     secretKey: 29202393,
 *     nonce: 462508,
 *     websiteId: 'abc123...',  // NEW: For lazy-loading support
 *     apiBaseUrl: 'http://localhost:8001'
 * };
 *
 * Built from modular sources in client/decrypt/src/
 * Run 'node client/decrypt/build.js' to rebuild after editing modules.
 */`;

function build() {
    console.log('Building decrypt-interceptor.js from modules...');
    console.log('Source directory:', SRC_DIR);
    console.log('');

    // Check all modules exist
    const missingModules = [];
    for (const module of MODULES) {
        const modulePath = path.join(SRC_DIR, module);
        if (!fs.existsSync(modulePath)) {
            missingModules.push(module);
        }
    }

    if (missingModules.length > 0) {
        console.error('ERROR: Missing modules:', missingModules.join(', '));
        process.exit(1);
    }

    // Read and concatenate modules
    let moduleContents = [];
    for (const module of MODULES) {
        const modulePath = path.join(SRC_DIR, module);
        const content = fs.readFileSync(modulePath, 'utf8');
        const lines = content.split('\n').length;
        const sectionName = SECTION_NAMES[module];

        console.log(`  ${module}: ${lines} lines`);

        // Add section header comment
        const sectionHeader = `    // ${'='.repeat(76)}\n    // === ${sectionName} ${'='.repeat(70 - sectionName.length)}\n    // ${'='.repeat(76)}\n`;

        // Indent content (4 spaces for IIFE body)
        const indentedContent = content
            .split('\n')
            .map(line => line ? '    ' + line : '')
            .join('\n');

        moduleContents.push(sectionHeader + '\n' + indentedContent);
    }

    // Wrap in IIFE
    const output = `${HEADER_COMMENT}
(function() {
    'use strict';

${moduleContents.join('\n\n')}

})();
`;

    // Write output
    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    const outputLines = output.split('\n').length;
    console.log('');
    console.log(`Output: ${OUTPUT_PATH}`);
    console.log(`Total lines: ${outputLines}`);

    // Run validation
    console.log('');
    console.log('Running validation...');
    try {
        // Execute validate.js
        require(VALIDATE_PATH);
        console.log('');
        console.log('BUILD SUCCESSFUL');
    } catch (err) {
        console.error('');
        console.error('BUILD FAILED - Validation error:');
        console.error(err.message);
        process.exit(1);
    }
}

build();
