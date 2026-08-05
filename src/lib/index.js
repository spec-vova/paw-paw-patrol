/**
 * Barrel for the pure logic modules.
 *
 * Nothing here touches the DOM or the network, so the same code runs in the
 * browser (src/app.js), in the serverless backend (api/registry.js) and in
 * the tests (tests/).
 */

export * from './pib.js';
export * from './registry.js';
export * from './declaration.js';
export * from './summary.js';
