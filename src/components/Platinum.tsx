/** PlayStation platinum trophy: platforms that have trophies, and the little trophy mark. */
export const PLATINUM_PLATFORMS = ['ps3', 'ps4', 'ps5', 'vita', 'psvr', 'psvr2-ps5'];
export const canPlatinum = (platform: string | null | undefined) => !!platform && PLATINUM_PLATFORMS.includes(platform);
export default function Platinum({ size = 16, off }: { size?: number; off?: boolean }) {
  return <img className={'platinum' + (off ? ' off' : '')} src="/platinum.png" width={size} height={size} alt={off ? '' : 'Platinum'} title={off ? undefined : 'Platinum trophy'} />;
}
