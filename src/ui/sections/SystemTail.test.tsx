import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { About } from './About';
import { SystemTail } from './SystemTail';
import { profileFor } from '@/core/profiles';

/**
 * Inspects the returned element tree directly — no DOM needed, and it asserts
 * the thing that keeps drifting: the order of the trailing blocks.
 *
 * Positions are found rather than hardcoded, so inserting a block at the front
 * cannot silently shift what every assertion is looking at.
 */
const childrenOf = (element: ReactElement): unknown[] => {
  const { children } = element.props as { children: unknown };
  return Array.isArray(children) ? children : [children];
};

const marker = (name: string) => ({ __marker: name }) as unknown as ReactElement;

const isAbout = (child: unknown): boolean => isValidElement(child) && child.type === About;

/** No profile, so the not-supported card renders nothing. */
const base = { profile: null } as const;

const indexOfMarker = (kids: unknown[], name: string): number =>
  kids.findIndex((child) => child != null && (child as { __marker?: string }).__marker === name);

describe('SystemTail', () => {
  it('runs Advanced, then capabilities', () => {
    const kids = childrenOf(
      SystemTail({
        ...base,
        advanced: marker('advanced'),
        capabilities: marker('capabilities'),
      }) as ReactElement,
    );

    const advanced = indexOfMarker(kids, 'advanced');
    expect(advanced).toBeGreaterThanOrEqual(0);
    expect(indexOfMarker(kids, 'capabilities')).toBeGreaterThan(advanced);
  });

  it('leaves About to the shell, which puts it after the app settings', () => {
    // Inside a section it would sit above App, and under the idle dim.
    const kids = childrenOf(SystemTail({ ...base, capabilities: marker('capabilities') }) as ReactElement);
    expect(kids.findIndex(isAbout)).toBe(-1);
  });

  it('puts the not-supported list above everything, not in the tail', () => {
    // It is about the hardware, so it belongs with the device blocks rather
    // than among the app-level ones the tail exists to order.
    const kids = childrenOf(
      SystemTail({
        profile: profileFor('sony', 'WH-1000XM5'),
        capabilities: marker('capabilities'),
      }) as ReactElement,
    );

    expect(indexOfMarker(kids, 'capabilities')).toBeGreaterThan(0);
  });
});
