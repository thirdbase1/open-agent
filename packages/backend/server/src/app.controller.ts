import { Controller, Get } from '@nestjs/common';

import { SkipThrottle } from './base';
import { Public } from './core/auth';

@Controller('/info')
export class AppController {
  @SkipThrottle()
  @Public()
  @Get()
  info() {
    return {
      compatibility: env.version,
      message: `Open-Agent ${env.version} Server`,
      type: env.DEPLOYMENT_TYPE,
      flavor: env.FLAVOR,
    };
  }

  @SkipThrottle()
  @Public()
  @Get('/health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: env.version,
      uptime: process.uptime(),
    };
  }
}
