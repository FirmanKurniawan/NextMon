/** JSON endpoints of the shared JS / integrations that PHP serves from ApiController: /json/<users|profiles|active|sales|vouchers|kick>. */
import { defineFeature } from '../types.ts';
import { restApi } from './api.ts';

export default defineFeature({ id: 'restapi', api: restApi });
