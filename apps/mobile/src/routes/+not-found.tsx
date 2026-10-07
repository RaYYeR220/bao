import { BadLink } from '@/features/bao/ui/bad-link'

/** Unknown paths, including links that looked like Bao links but did not validate. */
export default function NotFound() {
  return <BadLink />
}
