use anchor_lang::prelude::Pubkey;
use solana_sha256_hasher::hashv;

/// Leaf of a circle snapshot: sha256(0x00 || wallet).
pub fn merkle_leaf(wallet: &Pubkey) -> [u8; 32] {
    hashv(&[&[0u8], wallet.as_ref()]).to_bytes()
}

/// Inner node: sha256(0x01 || min(a, b) || max(a, b)).
pub fn hash_pair(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    hashv(&[&[1u8], lo, hi]).to_bytes()
}

pub fn verify_merkle(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let node = proof.iter().fold(leaf, |node, sibling| hash_pair(&node, sibling));
    &node == root
}

/// Code-word commitment bound to one packet: sha256(code || packet).
pub fn code_hash(code: &[u8], packet: &Pubkey) -> [u8; 32] {
    hashv(&[code, packet.as_ref()]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    /// Sorted-pair tree, odd node promoted; returns root and one proof per leaf.
    fn build(leaves: &[[u8; 32]]) -> ([u8; 32], Vec<Vec<[u8; 32]>>) {
        let mut level = leaves.to_vec();
        let mut proofs: Vec<Vec<[u8; 32]>> = vec![vec![]; leaves.len()];
        let mut pos: Vec<usize> = (0..leaves.len()).collect();
        while level.len() > 1 {
            let next: Vec<[u8; 32]> = level
                .chunks(2)
                .map(|p| if p.len() == 2 { hash_pair(&p[0], &p[1]) } else { p[0] })
                .collect();
            for (i, p) in pos.iter_mut().enumerate() {
                let sib = *p ^ 1;
                if sib < level.len() {
                    proofs[i].push(level[sib]);
                }
                *p /= 2;
            }
            level = next;
        }
        (level[0], proofs)
    }

    #[test]
    fn every_member_verifies_and_a_stranger_does_not() {
        let members: Vec<Pubkey> = (0..5).map(|_| Pubkey::new_unique()).collect();
        let leaves: Vec<[u8; 32]> = members.iter().map(merkle_leaf).collect();
        let (root, proofs) = build(&leaves);
        for (i, m) in members.iter().enumerate() {
            assert!(verify_merkle(&proofs[i], &root, merkle_leaf(m)));
        }
        assert!(!verify_merkle(&proofs[0], &root, merkle_leaf(&Pubkey::new_unique())));
    }

    #[test]
    fn single_member_circle_has_empty_proof() {
        let m = Pubkey::new_unique();
        let (root, proofs) = build(&[merkle_leaf(&m)]);
        assert!(proofs[0].is_empty());
        assert!(verify_merkle(&proofs[0], &root, merkle_leaf(&m)));
    }

    #[test]
    fn leaf_is_domain_separated_from_nodes() {
        let m = Pubkey::new_unique();
        assert_ne!(merkle_leaf(&m), hash_pair(&[0u8; 32], &m.to_bytes()));
    }

    #[test]
    fn code_hash_is_bound_to_the_packet() {
        let (p1, p2) = (Pubkey::new_unique(), Pubkey::new_unique());
        assert_ne!(code_hash(b"gongxi", &p1), code_hash(b"gongxi", &p2));
        assert_eq!(code_hash(b"gongxi", &p1), code_hash(b"gongxi", &p1));
        assert_ne!(code_hash(b"gongxi", &p1), code_hash(b"facai", &p1));
    }
}
