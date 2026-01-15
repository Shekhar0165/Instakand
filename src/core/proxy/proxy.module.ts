import { Module, Global } from '@nestjs/common';
import { ProxyService } from './proxy.service';

@Global()
@Module({
    providers: [ProxyService],
    exports: [ProxyService],
})
export class ProxyModule { }
