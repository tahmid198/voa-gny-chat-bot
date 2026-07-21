/* eslint-disable @next/next/no-img-element */

/**
 * Renders both logo variants and lets CSS pick one, so the correct mark shows
 * on the very first paint with no theme-detection flicker.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <>
      <img
        src="/VOA-black.svg"
        alt="VOA-GNY"
        className={`${className} block dark:hidden`}
        draggable={false}
      />
      <img
        src="/VOA-white.svg"
        alt="VOA-GNY"
        className={`${className} hidden dark:block`}
        draggable={false}
      />
    </>
  );
}
