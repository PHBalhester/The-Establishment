'use client';

/**
 * Kit Demo Page -- Visual showcase of all Phase 60 component kit primitives.
 *
 * Temporary page for checkpoint verification. Navigate to /kit to see every
 * component rendered with its variants and states. Will be removed after
 * Phase 60 verification is complete.
 */

import { useState } from 'react';
import {
  Frame,
  Button,
  Input,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  Toggle,
  Slider,
  Card,
  Divider,
  Scrollbar,
} from '@/components/kit';

/* -------------------------------------------------------------------------- */
/*  Section wrapper for consistent layout                                      */
/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '2.5rem' }}>
      <h2
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '1.25rem',
          color: 'var(--color-factory-accent)',
          marginBottom: '1rem',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Demo page                                                                  */
/* -------------------------------------------------------------------------- */

export default function KitDemoPage() {
  // State for interactive components
  const [toggleA, setToggleA] = useState(false);
  const [toggleB, setToggleB] = useState(true);
  const [sliderVal, setSliderVal] = useState(50);
  const [activeTab, setActiveTab] = useState('stake');
  const [inputVal, setInputVal] = useState('');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-factory-bg)',
        color: 'var(--color-factory-text)',
        padding: '2rem',
        maxWidth: '900px',
        margin: '0 auto',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-heading)',
          fontSize: '2rem',
          color: 'var(--color-factory-accent)',
          marginBottom: '0.5rem',
          textAlign: 'center',
        }}
      >
        Component Kit -- Phase 60
      </h1>
      <p
        style={{
          textAlign: 'center',
          color: 'var(--color-factory-text-secondary)',
          marginBottom: '3rem',
          fontSize: '0.875rem',
        }}
      >
        All 9 kit primitives rendered with their variants and states
      </p>

      {/* ================================================================== */}
      {/*  FRAME                                                              */}
      {/* ================================================================== */}
      <Section title="Frame">
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <p style={{ fontSize: '0.75rem', marginBottom: '0.5rem', opacity: 0.7 }}>
              mode=&quot;css&quot; (default)
            </p>
            <Frame mode="css" padding="md">
              <p>CSS-only frame with border-radius, box-shadow, and parchment gradient background.</p>
            </Frame>
          </div>
          <div style={{ flex: '1 1 300px' }}>
            <p style={{ fontSize: '0.75rem', marginBottom: '0.5rem', opacity: 0.7 }}>
              mode=&quot;asset&quot; (border-image 9-slice)
            </p>
            <Frame mode="asset" padding="md">
              <p>Asset-based frame using riveted-paper.png via CSS border-image. Rectangular only (no border-radius).</p>
            </Frame>
          </div>
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  CARD                                                                */}
      {/* ================================================================== */}
      <Section title="Card">
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <Card header="Portfolio Summary">
              <p>Total staked: 1,234 CRIME</p>
              <p>Pending rewards: 56.7 PROFIT</p>
            </Card>
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <Card frame="asset" header="Epoch Rewards">
              <p>Current yield: 4.2%</p>
              <p>Next epoch: 2h 14m</p>
            </Card>
          </div>
          <div style={{ flex: '1 1 280px' }}>
            <Card>
              <p>Headerless card -- just a framed content region.</p>
            </Card>
          </div>
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  DIVIDER                                                             */}
      {/* ================================================================== */}
      <Section title="Divider">
        <Frame mode="css" padding="md">
          <p style={{ marginBottom: '0.5rem' }}>Simple (default):</p>
          <Divider variant="simple" />
          <p style={{ margin: '0.5rem 0' }}>Ornate (scrollwork dots):</p>
          <Divider variant="ornate" />
          <p style={{ margin: '0.5rem 0' }}>Riveted (rivet dots):</p>
          <Divider variant="riveted" />
        </Frame>
      </Section>

      {/* ================================================================== */}
      {/*  BUTTON                                                              */}
      {/* ================================================================== */}
      <Section title="Button">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.7, width: '80px' }}>Primary:</span>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="md">Medium</Button>
            <Button variant="primary" size="lg">Large</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.7, width: '80px' }}>Secondary:</span>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="secondary" size="md">Medium</Button>
            <Button variant="secondary" size="lg">Large</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.7, width: '80px' }}>Ghost:</span>
            <Button variant="ghost" size="sm">Small</Button>
            <Button variant="ghost" size="md">Medium</Button>
            <Button variant="ghost" size="lg">Large</Button>
            <Button variant="ghost" disabled>Disabled</Button>
          </div>
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  INPUT                                                               */}
      {/* ================================================================== */}
      <Section title="Input">
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 250px' }}>
            <Input
              label="Swap Amount"
              placeholder="0.00"
              suffix="SOL"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
            />
          </div>
          <div style={{ flex: '1 1 250px' }}>
            <Input
              label="Slippage"
              placeholder="50"
              suffix="BPS"
              error="Value exceeds maximum (500 BPS)"
            />
          </div>
          <div style={{ flex: '1 1 250px' }}>
            <Input
              variant="flush"
              placeholder="Flush variant (minimal inline)"
            />
          </div>
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  TABS                                                                */}
      {/* ================================================================== */}
      <Section title="Tabs">
        <Tabs value={activeTab} onChange={setActiveTab}>
          <TabList>
            <Tab value="stake">Stake</Tab>
            <Tab value="unstake">Unstake</Tab>
            <Tab value="claim">Claim</Tab>
            <Tab value="disabled" disabled>Disabled</Tab>
          </TabList>
          <div style={{ marginTop: '1rem' }}>
            <TabPanel value="stake">
              <Frame mode="css" padding="sm">
                <p>Stake your CRIME or FRAUD tokens to earn PROFIT yields.</p>
              </Frame>
            </TabPanel>
            <TabPanel value="unstake">
              <Frame mode="css" padding="sm">
                <p>Withdraw your staked tokens. 7-day cooldown period applies.</p>
              </Frame>
            </TabPanel>
            <TabPanel value="claim">
              <Frame mode="css" padding="sm">
                <p>Claim accumulated PROFIT rewards from your staking position.</p>
              </Frame>
            </TabPanel>
          </div>
        </Tabs>
      </Section>

      {/* ================================================================== */}
      {/*  TOGGLE                                                              */}
      {/* ================================================================== */}
      <Section title="Toggle">
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <Toggle
            checked={toggleA}
            onChange={setToggleA}
            label="Auto-compound"
          />
          <Toggle
            checked={toggleB}
            onChange={setToggleB}
            label="Show advanced"
          />
          <Toggle
            checked={false}
            onChange={() => {}}
            label="Disabled toggle"
            disabled
          />
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  SLIDER                                                              */}
      {/* ================================================================== */}
      <Section title="Slider">
        <div style={{ maxWidth: '400px' }}>
          <Slider
            value={sliderVal}
            onChange={setSliderVal}
            min={0}
            max={100}
            label="Slippage Tolerance"
            showValue
            formatValue={(v) => `${v} BPS`}
          />
        </div>
      </Section>

      {/* ================================================================== */}
      {/*  SCROLLBAR                                                           */}
      {/* ================================================================== */}
      <Section title="Scrollbar">
        <Frame mode="css" padding="sm">
          <Scrollbar className="max-h-32">
            {Array.from({ length: 20 }, (_, i) => (
              <p key={i} style={{ padding: '0.25rem 0', fontSize: '0.875rem' }}>
                Scrollable item #{i + 1} -- themed scrollbar with brass accent
              </p>
            ))}
          </Scrollbar>
        </Frame>
      </Section>

      {/* Footer */}
      <Divider variant="ornate" />
      <p
        style={{
          textAlign: 'center',
          color: 'var(--color-factory-text-secondary)',
          fontSize: '0.75rem',
          marginTop: '1rem',
        }}
      >
        Phase 60 -- Design Tokens + Component Kit -- Checkpoint Verification
      </p>
    </div>
  );
}
