.PHONY: webworker.bundle.js
webworker.bundle.js: preview/playground/worker/webworker.bundle.js

# Create webworker.bundle.js by combining these files.
# There's probably a better way to do this using webpack but this works.
preview/playground/worker/webworker.bundle.js: preview/playground/worker/parts.js preview/playground/worker/runner.js preview/playground/worker/wiring.js preview/playground/worker/webworker.js
	cat $^ > $@
