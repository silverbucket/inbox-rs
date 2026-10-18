// Keep the existing command while all targets share one submission pipeline.
process.argv.splice(2, process.argv.length - 2, 'thunderbird');
await import('./package-submissions.mjs');
