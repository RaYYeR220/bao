/// Equal split: floor(remaining / shares_left); the last share takes the remainder.
/// Precondition: `remaining >= shares_left >= 1`.
pub fn equal_share(remaining: u64, shares_left: u16) -> u64 {
    if shares_left <= 1 {
        return remaining;
    }
    remaining / shares_left as u64
}

/// WeChat-style double-mean split. Draws uniformly from `[1, cap]` where
/// `cap = min(2 * remaining / shares_left, remaining - (shares_left - 1))`, so every later
/// share keeps at least one unit and the last share takes the rest.
/// Precondition: `remaining >= shares_left >= 1`.
pub fn lucky_share(remaining: u64, shares_left: u16, randomness: &[u8; 32]) -> u64 {
    let n = shares_left as u64;
    if n <= 1 {
        return remaining;
    }
    let max_for_this = remaining - (n - 1);
    let double_mean = ((remaining as u128 * 2) / n as u128) as u64;
    let cap = double_mean.min(max_for_this).max(1);
    let mut word = [0u8; 8];
    word.copy_from_slice(&randomness[..8]);
    1 + u64::from_le_bytes(word) % cap
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn rnd(seed: u64) -> [u8; 32] {
        let mut r = [0u8; 32];
        r[..8].copy_from_slice(&seed.wrapping_mul(0x9E37_79B9_7F4A_7C15).to_le_bytes());
        r
    }

    #[test]
    fn last_share_takes_everything() {
        assert_eq!(lucky_share(777, 1, &rnd(1)), 777);
        assert_eq!(equal_share(777, 1), 777);
    }

    #[test]
    fn equal_split_floors_and_last_takes_remainder() {
        let mut remaining = 10u64;
        let mut got = vec![];
        for left in (1..=3u16).rev() {
            let a = equal_share(remaining, left);
            remaining -= a;
            got.push(a);
        }
        assert_eq!(got, vec![3, 3, 4]);
    }

    #[test]
    fn lucky_share_stays_within_double_mean() {
        for s in 0..1000u64 {
            let a = lucky_share(1_000_000, 4, &rnd(s));
            assert!((1..=500_000).contains(&a), "share {a} outside [1, 2*mean]");
        }
    }

    /// Pinned vector shared with the TypeScript SDK so both sides compute identical shares.
    #[test]
    fn cross_language_vector() {
        assert_eq!(lucky_share(1_000_000, 4, &[11u8; 32]), 343_404);
    }

    proptest! {
        #[test]
        fn lucky_sums_exactly_and_never_starves(total in 1u64..=1_000_000_000_000, shares in 1u16..=200, seed in any::<u64>()) {
            prop_assume!(total >= shares as u64);
            let mut remaining = total;
            let mut sum = 0u64;
            for i in 0..shares {
                let left = shares - i;
                let a = lucky_share(remaining, left, &rnd(seed ^ i as u64));
                prop_assert!(a >= 1);
                prop_assert!(remaining - a >= (left - 1) as u64);
                remaining -= a;
                sum += a;
            }
            prop_assert_eq!(sum, total);
            prop_assert_eq!(remaining, 0);
        }

        #[test]
        fn equal_sums_exactly(total in 1u64..=1_000_000_000_000, shares in 1u16..=200) {
            prop_assume!(total >= shares as u64);
            let mut remaining = total;
            for i in 0..shares {
                let a = equal_share(remaining, shares - i);
                prop_assert!(a >= 1);
                remaining -= a;
            }
            prop_assert_eq!(remaining, 0);
        }
    }
}
