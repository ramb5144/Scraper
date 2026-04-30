#!/usr/bin/env node

/**
 * Verification script for security vulnerability fix
 *
 * This script analyzes cloak-sdk.js to verify that:
 * 1. No _cloakOriginal DOM property assignment exists
 * 2. WeakMap storage is used instead
 * 3. uploadPlaintextToServer only uses WeakMap
 */

const fs = require('fs');
const path = require('path');

const sdkPath = path.join(__dirname, 'client/cloak-sdk.js');
const content = fs.readFileSync(sdkPath, 'utf8');

console.log('=== Cloak Security Fix Verification ===\n');

// Test 1: Check for _cloakOriginal assignment in actual code (not comments)
console.log('Test 1: Checking for vulnerable _cloakOriginal assignments...');
const lines = content.split('\n');
let vulnerableAssignments = 0;
let assignmentLines = [];

lines.forEach((line, index) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
        return;
    }

    // Look for assignment pattern: ._cloakOriginal =
    if (/\._cloakOriginal\s*=/.test(line) && !line.includes('//')) {
        vulnerableAssignments++;
        assignmentLines.push({
            line: index + 1,
            content: line.trim()
        });
    }
});

if (vulnerableAssignments > 0) {
    console.log('❌ FAIL: Found vulnerable _cloakOriginal assignments:');
    assignmentLines.forEach(a => {
        console.log(`   Line ${a.line}: ${a.content}`);
    });
} else {
    console.log('✅ PASS: No _cloakOriginal assignments found in code');
}

// Test 2: Verify WeakMap storage exists
console.log('\nTest 2: Checking for WeakMap storage...');
const hasWeakMapDeclaration = /const\s+plaintextStorage\s*=\s*new\s+WeakMap/.test(content);
const hasWeakMapSet = /plaintextStorage\.set\(textNode,\s*textToEncrypt\)/.test(content);

if (hasWeakMapDeclaration && hasWeakMapSet) {
    console.log('✅ PASS: WeakMap storage is properly implemented');
} else {
    console.log('❌ FAIL: WeakMap storage not found or incomplete');
}

// Test 3: Verify uploadPlaintextToServer uses WeakMap
console.log('\nTest 3: Checking uploadPlaintextToServer implementation...');
const uploadFunction = content.substring(
    content.indexOf('function uploadPlaintextToServer'),
    content.indexOf('// ========================================', content.indexOf('function uploadPlaintextToServer'))
);

const hasFastPath = /if\s*\(textNode\._cloakEncrypted\s*&&\s*textNode\._cloakOriginal\)/.test(uploadFunction);
const hasWeakMapPath = /plaintextStorage\.get\(textNode\)/.test(uploadFunction);

if (!hasFastPath && hasWeakMapPath) {
    console.log('✅ PASS: uploadPlaintextToServer uses WeakMap only (no fast path)');
} else if (hasFastPath) {
    console.log('❌ FAIL: Fast path still checks _cloakOriginal property');
} else {
    console.log('⚠️  WARN: Could not verify uploadPlaintextToServer logic');
}

// Test 4: Check documentation
console.log('\nTest 4: Checking documentation...');
const knownExposuresSection = content.substring(
    content.indexOf('KNOWN EXPOSURES:'),
    content.indexOf('BOTTOM LINE:', content.indexOf('KNOWN EXPOSURES:'))
);

const docMentionsCloakOriginal = /_cloakOriginal/.test(knownExposuresSection);

if (!docMentionsCloakOriginal) {
    console.log('✅ PASS: _cloakOriginal removed from known exposures documentation');
} else {
    console.log('❌ FAIL: Documentation still mentions _cloakOriginal as exposure');
}

// Overall result
console.log('\n=== Summary ===');
const allPassed = vulnerableAssignments === 0 &&
                  hasWeakMapDeclaration &&
                  hasWeakMapSet &&
                  !hasFastPath &&
                  hasWeakMapPath &&
                  !docMentionsCloakOriginal;

if (allPassed) {
    console.log('✅ ALL TESTS PASSED: Security fix verified successfully!');
    console.log('\nThe vulnerability has been fixed:');
    console.log('- Plaintext is no longer stored in DOM properties');
    console.log('- WeakMap storage provides the same functionality');
    console.log('- Extraction via DOM traversal will now fail');
    process.exit(0);
} else {
    console.log('❌ SOME TESTS FAILED: Security fix incomplete');
    process.exit(1);
}
