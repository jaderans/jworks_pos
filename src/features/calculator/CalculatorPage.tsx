import { useState } from 'react';
import { PageHeader, Segmented } from '../../components/ui';
import { ServiceQuote } from './ServiceQuote';
import { StickerJob } from './StickerJob';
import { QuickCheck } from './QuickCheck';
import { QuotesArchive } from './QuotesArchive';
import { RatesEditor } from './RatesEditor';

type Tab = 'service' | 'sticker' | 'check' | 'quotes' | 'rates';

export default function CalculatorPage() {
  const [tab, setTab] = useState<Tab>('service');
  return (
    <div className="page">
      <PageHeader
        title="Pricing calculator"
        subtitle="Quote logos, branding, shirt designs, tarpaulins, layouts and sticker jobs from your real rates. Markup and margin are not the same number; this works in margin."
      />
      <Segmented<Tab>
        label="Calculator"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'service', label: 'Service quote' },
          { value: 'sticker', label: 'Sticker job' },
          { value: 'check', label: 'Quick check' },
          { value: 'quotes', label: 'Quotes' },
          { value: 'rates', label: 'Rates' },
        ]}
      />
      {tab === 'service' ? <ServiceQuote /> : tab === 'sticker' ? <StickerJob /> : tab === 'check' ? <QuickCheck /> : tab === 'quotes' ? <QuotesArchive /> : <RatesEditor />}
    </div>
  );
}
