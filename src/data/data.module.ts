import { Module, Global } from '@nestjs/common';
import { DataService } from './data.service';

@Global()
@Module({
    providers: [DataService],
    exports: [DataService],
})
export class DataModule { }
