//! Epoch Program instructions.

pub mod consume_randomness;
pub mod execute_carnage;
pub mod execute_carnage_atomic;
pub mod expire_carnage;
#[cfg(feature = "devnet")]
pub mod force_carnage;
pub mod initialize_carnage_fund;
pub mod initialize_epoch_state;
pub mod retry_epoch_vrf;
pub mod trigger_epoch_transition;

pub use consume_randomness::*;
pub use execute_carnage::*;
pub use execute_carnage_atomic::*;
pub use expire_carnage::*;
#[cfg(feature = "devnet")]
pub use force_carnage::*;
pub use initialize_carnage_fund::*;
pub use initialize_epoch_state::*;
pub use retry_epoch_vrf::*;
pub use trigger_epoch_transition::*;
