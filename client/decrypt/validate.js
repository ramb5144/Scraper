#!/usr/bin/env node
/**
 * Validation script for decrypt-interceptor.js
 * Checks that the file hasn't been corrupted.
 */

const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'decrypt-interceptor.js');

// Expected characteristics of a valid file
const EXPECTED = {
    minLines: 3500,
    maxLines: 4500,
    mustContain: [
        'function setupCopyInterception()',
        'function buildTextPositionMap()',
        'function searchServerSide(',
        'function highlightMatches(',
        'function setupSearchInterception()',
        'function setupWordSelectionInterception()',
        '(function()',  // IIFE start
        '})();'         // IIFE end
    ],
    mustStartWith: '/**',
    mustEndWith: '})();'
};

function validate() {
    if (!fs.existsSync(FILE_PATH)) {
        console.error('ERROR: decrypt-interceptor.js not found!');
        process.exit(1);
    }

    const content = fs.readFileSync(FILE_PATH, 'utf8');
    const lines = content.split('\n');
    const errors = [];

    // Check line count
    if (lines.length < EXPECTED.minLines) {
        errors.push(`File too short: ${lines.length} lines (expected >= ${EXPECTED.minLines})`);
    }
    if (lines.length > EXPECTED.maxLines) {
        errors.push(`File too long: ${lines.length} lines (expected <= ${EXPECTED.maxLines})`);
    }

    // Check required functions exist
    for (const pattern of EXPECTED.mustContain) {
        if (!content.includes(pattern)) {
            errors.push(`Missing required pattern: "${pattern}"`);
        }
    }

    // Check file structure
    const trimmedContent = content.trim();
    if (!trimmedContent.startsWith(EXPECTED.mustStartWith)) {
        errors.push(`File should start with "${EXPECTED.mustStartWith}"`);
    }
    if (!trimmedContent.endsWith(EXPECTED.mustEndWith)) {
        errors.push(`File should end with "${EXPECTED.mustEndWith}"`);
    }

    // Check syntax with Node
    try {
        new Function(content);
    } catch (e) {
        errors.push(`Syntax error: ${e.message}`);
    }

    // Report results
    if (errors.length > 0) {
        console.error('VALIDATION FAILED:');
        errors.forEach(e => console.error('  - ' + e));
        console.error('\nThe file may be corrupted. Restore from backup:');
        console.error('  git checkout HEAD -- client/decrypt-interceptor.js');
        console.error('  OR');
        console.error('  cp client/decrypt/backup.js client/decrypt-interceptor.js');
        process.exit(1);
    }

    console.log('VALIDATION PASSED');
    console.log(`  Lines: ${lines.length}`);
    console.log(`  All required functions present`);
    console.log(`  Syntax OK`);
}

validate();
