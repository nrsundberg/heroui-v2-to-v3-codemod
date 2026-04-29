import { addToast } from '@heroui/react';

export function ShowToasts() {
  addToast({ title: 'Saved', color: 'success' });
  addToast({ title: 'Failed', description: 'Try again', color: 'error' });

  function later() {
    return addToast({ title: 'Heads up', color: 'info' });
  }

  return <button onClick={() => addToast({ title: 'Click' })}>Go</button>;
}
