#!/usr/bin/env node
import { createCac } from 'devframe/adapters/cac';
import ngDevtools from '@santoshyadavdev/ng-devtools/devframe';
import { guardReportOutDir } from '@santoshyadavdev/ng-devtools/cli';

createCac(ngDevtools, { mcp: true, configureCli: guardReportOutDir }).parse();
