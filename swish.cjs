'use strict';

const crypto = require('node:crypto');

const DEFAULT_SWISH_NUMBER = '0739579244';
const RENEWAL_AMOUNT_KR = 40;
const RENEWAL_DAYS = 30;

function createSwish(env = process.env) {
  const number = String(env.SWISH_NUMBER || DEFAULT_SWISH_NUMBER).replace(/\s+/g, '');
  return Object.freeze({
    number,
    amount: RENEWAL_AMOUNT_KR,
    durationDays: RENEWAL_DAYS,
    createReference() {
      return 'TR' + crypto.randomBytes(4).toString('hex').toUpperCase();
    }
  });
}

module.exports = { createSwish, RENEWAL_AMOUNT_KR, RENEWAL_DAYS };
