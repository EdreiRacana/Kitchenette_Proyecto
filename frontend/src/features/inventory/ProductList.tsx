import { useState, useEffect } from 'react';
import { inventoryService, type Product } from './service';
import { Plus, Search, Filter } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ProductList() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadProducts();
    }, []);

    const loadProducts = async () => {
        try {
            const data = await inventoryService.getProducts();
            setProducts(data);
        } catch (error) {
            console.error('Failed to load products', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredProducts = products.filter(product =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.variants.some(v => v.sku.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="px-4 sm:px-6 lg:px-8 py-8">
            <div className="sm:flex sm:items-center">
                <div className="sm:flex-auto">
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Inventory</h1>
                    <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        A list of all products including their name, SKU, price, and current stock levels.
                    </p>
                </div>
                <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
                    <Link
                        to="/inventory/new"
                        className="inline-flex items-center justify-center rounded-md border border-transparent bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 sm:w-auto"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Link>
                </div>
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <div className="relative flex-grow max-w-md">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                        <Search className="h-5 w-5 text-gray-400" aria-hidden="true" />
                    </div>
                    <input
                        type="text"
                        className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 leading-5 placeholder-gray-500 focus:border-primary-500 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                        placeholder="Search products or SKUs"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <button
                    type="button"
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                >
                    <Filter className="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" />
                    Filter
                </button>
            </div>

            <div className="mt-8 flex flex-col">
                <div className="-my-2 -mx-4 overflow-x-auto sm:-mx-6 lg:-mx-8">
                    <div className="inline-block min-w-full py-2 align-middle md:px-6 lg:px-8">
                        <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                            <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-800">
                                    <tr>
                                        <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">
                                            Name
                                        </th>
                                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                                            Category
                                        </th>
                                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                                            Variants
                                        </th>
                                        <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                                            Total Stock
                                        </th>
                                        <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                                            <span className="sr-only">Edit</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                                    {loading ? (
                                        <tr>
                                            <td colSpan={5} className="text-center py-4 text-sm text-gray-500">Loading...</td>
                                        </tr>
                                    ) : filteredProducts.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="text-center py-4 text-sm text-gray-500">No products found.</td>
                                        </tr>
                                    ) : (
                                        filteredProducts.map((product) => (
                                            <tr key={product.id}>
                                                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-white sm:pl-6">
                                                    {product.name}
                                                    {product.image_url && (
                                                        <img src={product.image_url} alt="" className="ml-2 h-8 w-8 inline-block rounded-full object-cover" />
                                                    )}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300">
                                                    {product.category || 'Uncategorized'}
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300">
                                                    {product.variants.length} variants
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-300">
                                                    {product.variants.reduce((acc, v) => acc + (v.stock_levels?.reduce((s, l) => s + l.quantity, 0) || 0), 0)}
                                                </td>
                                                <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                                                    <a href="#" className="text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-300">
                                                        Edit<span className="sr-only">, {product.name}</span>
                                                    </a>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
