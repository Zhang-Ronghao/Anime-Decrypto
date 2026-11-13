import catalogMetadata from '../../worker/data/bangumi-popular-anime.meta.json';

export const BANGUMI_POPULAR_SOURCE_DATE = catalogMetadata.sourceDate;

export const DEFAULT_BANGUMI_POPULAR_CATALOG = {
  limit: 1000,
  yearMin: 2005,
  yearMax: Number(catalogMetadata.sourceDate.slice(0, 4)),
};
