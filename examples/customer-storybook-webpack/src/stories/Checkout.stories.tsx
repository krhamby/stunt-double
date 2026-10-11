import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { Checkout } from '@acme/core';
import { products } from '../products';

// The SDK's own <Checkout>: every Button / PriceTag / Logo it renders internally is the project's override.
const meta = {
  title: 'SDK/Checkout',
  component: Checkout,
  decorators: [(Story) => <section data-probe="sdk"><Story /></section>],
  args: { products },
} satisfies Meta<typeof Checkout>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
