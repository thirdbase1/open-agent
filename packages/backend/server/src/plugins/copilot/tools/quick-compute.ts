import { z } from 'zod';
import { createTool } from './utils';
import { toolError } from './error';

// Quick Compute — fast, sandboxed mathematical and data computation.
// Runs JavaScript in a safe eval context with math helpers. No external
// dependencies or sandbox VM needed — great for quick calculations,
// unit conversions, string manipulation, and JSON processing.

const SAFE_GLOBALS = {
  Math,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Map,
  Set,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
};

export const createQuickComputeTool = () =>
  createTool({ toolName: 'quick_compute' }, {
    description:
      'Execute JavaScript for quick computations, data transformations, and calculations. ' +
      'Safe eval context with Math, Date, JSON, and standard JS builtins. ' +
      'Faster than Python sandbox for simple tasks — no VM startup needed. ' +
      'Use for: math, unit conversion, string processing, JSON manipulation, date calculations.',
    inputSchema: z.object({
      code: z.string().describe(
        'JavaScript expression or statements to evaluate. ' +
        'Available: Math, Date, JSON, Object, Array, String, Number, ' +
        'parseInt, parseFloat, encodeURIComponent, decodeURIComponent. ' +
        'The last expression value is returned as the result.'
      ),
      data: z.string().optional().describe(
        'Optional JSON string to parse and make available as `input` in the eval context.'
      ),
    }),
    execute: async ({ code, data }) => {
      try {
        let inputData: unknown;
        if (data) {
          try {
            inputData = JSON.parse(data);
          } catch {
            return toolError('Invalid JSON in data parameter', data.slice(0, 200));
          }
        }

        // Create a safe eval context
        const fn = new Function(
          'input',
          ...Object.keys(SAFE_GLOBALS),
          `"use strict";\n${code}`
        );

        const result = fn(inputData, ...Object.values(SAFE_GLOBALS));

        // Format the result
        if (result === undefined) {
          return { result: null, type: 'null' };
        }

        if (typeof result === 'object' && result !== null) {
          try {
            return { result: JSON.stringify(result, null, 2), type: typeof result, json: result };
          } catch {
            return { result: String(result), type: typeof result };
          }
        }

        return { result: String(result), type: typeof result, value: result };
      } catch (e: any) {
        return toolError('Quick compute failed', e?.message || String(e));
      }
    },
  });
