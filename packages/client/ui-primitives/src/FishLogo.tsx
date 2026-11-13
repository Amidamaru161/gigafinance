// GigaFinance brand mark: a gradient sphere cut by a swooshing ribbon that
// ends in a rising arrow (generated in Figma from the GigaChat sphere mark,
// file "GigaFinance logo"). The component keeps its historical name
// (FishLogo) so every call site stays unchanged.

import { useId } from 'react'
import type { IconProps } from './icons/props.ts'

const CIRCLE = 'M256 464C370.875 464 464 370.875 464 256C464 141.125 370.875 48 256 48C141.125 48 48 141.125 48 256C48 370.875 141.125 464 256 464Z'
const RIBBON = 'M40 258C74 279 107 289 142 288L100 190L160 242L196 190L184 279C258 251 326 191 376 142L332 144L426 91L433 198L406 175C343 258 267 327 183 346C126 359 78 350 40 328V258Z'

/** Mark geometry for embedding inside another svg (wordmark). */
export function GigaMarkShapes({ uid }: { uid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${uid}g`} x1="92" y1="92" x2="420" y2="420" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22D3EE" />
          <stop offset="0.52" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#E879F9" />
        </linearGradient>
        <mask id={`${uid}m`} maskUnits="userSpaceOnUse" x="40" y="40" width="432" height="432" style={{ maskType: 'luminance' }}>
          <path d={CIRCLE} fill="white" />
          <path d={RIBBON} fill="black" />
        </mask>
      </defs>
      <path d={CIRCLE} fill={`url(#${uid}g)`} mask={`url(#${uid}m)`} />
    </>
  )
}

/** Stable, selector-safe id prefix per mounted instance. */
export function useMarkId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
}

/**
 * Render the brand mark.
 * @param props.size - width/height in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  const uid = useMarkId('gfm')
  return (
    <svg width={size} height={size} className={className} viewBox="44 44 424 424" fill="none" aria-hidden="true">
      <GigaMarkShapes uid={uid} />
    </svg>
  )
}
