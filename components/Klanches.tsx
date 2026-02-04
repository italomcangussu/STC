import React, { useState, useEffect } from 'react';
import { User, Product, Consumption, Reservation, Court } from '../types';
import {
    ShoppingCart, CheckCircle, Plus, Loader2, Package, Droplets,
    Beer, CupSoda, Candy, X, Save, Users, Edit, Trash2, Image,
    ChevronDown, ChevronUp, DollarSign, AlertCircle, Calendar, Clock, MapPin
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getNowInFortaleza, formatDate } from '../utils';

interface KlanchesProps {
    currentUser: User;
}

interface CartItem {
    productId: string;
    quantity: number;
    price: number;
}

interface ExtendedProduct extends Product {
    imageUrl?: string;
    icon?: string;
    stockQuantity?: number;
}

// Icon mapping
const ICON_MAP: Record<string, React.ReactNode> = {
    'droplets': <Droplets size={24} />,
    'cup-soda': <CupSoda size={24} />,
    'beer': <Beer size={24} />,
    'candy': <Candy size={24} />,
    'package': <Package size={24} />,
};

export const Klanches: React.FC<KlanchesProps> = ({ currentUser }) => {
    const [consumptions, setConsumptions] = useState<Consumption[]>([]);
    const [products, setProducts] = useState<ExtendedProduct[]>([]);
    const [profiles, setProfiles] = useState<User[]>([]);
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [cart, setCart] = useState<CartItem[]>([]);
    const [reservations, setReservations] = useState<Reservation[]>([]);
    const [courts, setCourts] = useState<Court[]>([]);
    const [activeTab, setActiveTab] = useState<'produtos' | 'devedores' | 'no_clube'>('produtos');
    const [expandedDebtor, setExpandedDebtor] = useState<string | null>(null);
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ExtendedProduct | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        setUploadingImage(true);
        try {
            const { error: uploadError } = await supabase.storage
                .from('klancheimages')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data } = supabase.storage
                .from('klancheimages')
                .getPublicUrl(filePath);

            setProductForm(prev => ({ ...prev, imageUrl: data.publicUrl }));
        } catch (error: any) {
            console.error('Error uploading image:', error);
            alert('Erro ao fazer upload da imagem.');
        } finally {
            setUploadingImage(false);
        }
    };

    // Product form state
    const [productForm, setProductForm] = useState({
        name: '',
        price: '',
        imageUrl: '',
        icon: 'package',
        stockQuantity: '0'
    });

    // Fetch data from Supabase
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            const { data: productsData } = await supabase
                .from('products')
                .select('*')
                .eq('is_active', true);

            setProducts((productsData || []).map(p => ({
                id: p.id,
                name: p.name,
                price: Number(p.price),
                active: p.is_active,
                imageUrl: p.image_url,
                icon: p.icon || 'package',
                stockQuantity: p.stock_quantity || 0
            })));

            const { data: consumptionsData } = await supabase
                .from('consumptions')
                .select('*')
                .order('date', { ascending: false });

            setConsumptions((consumptionsData || []).map(c => ({
                id: c.id,
                userId: c.user_id,
                productId: c.product_id,
                quantity: c.quantity,
                totalPrice: Number(c.total_price),
                date: typeof c.date === 'string' ? c.date.split('T')[0] : getNowInFortaleza().toISOString().split('T')[0],
                status: c.status
            })));

            const { data: profilesData } = await supabase
                .from('profiles')
                .select('id, name, avatar_url, role')
                .in('role', ['socio', 'admin'])
                .eq('is_active', true);

            setProfiles((profilesData || []).map(p => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar_url,
                role: p.role,
                isActive: true,
                email: '',
                phone: '',
                balance: 0
            } as User)));

            // Fetch today's reservations
            const today = formatDate(getNowInFortaleza());
            const { data: reservationsData } = await supabase
                .from('reservations')
                .select('*')
                .eq('date', today)
                .eq('status', 'active');

            setReservations((reservationsData || []).map(r => ({
                id: r.id,
                type: r.type,
                date: r.date,
                startTime: r.start_time,
                endTime: r.end_time,
                courtId: r.court_id,
                creatorId: r.creator_id,
                participantIds: r.participant_ids || [],
                guestName: r.guest_name,
                guestResponsibleId: r.guest_responsible_id,
                status: r.status
            } as Reservation)));

            // Fetch courts
            const { data: courtsData } = await supabase
                .from('courts')
                .select('*')
                .eq('is_active', true);

            setCourts((courtsData || []).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                isActive: c.is_active
            } as Court)));

            setLoading(false);
        };

        fetchData();
    }, []);

    // Loading state
    if (loading) {
        return (
            <div className="p-4 flex items-center justify-center min-h-[200px]">
                <Loader2 className="animate-spin text-saibro-500" size={32} />
            </div>
        );
    }

    // ========== SOCIO/ADMIN VIEW (Consumer View) ==========
    if (currentUser.role === 'socio' || currentUser.role === 'admin') {
        const myConsumptions = consumptions.filter(c => c.userId === currentUser.id && c.status === 'open');
        const totalDue = myConsumptions.reduce((acc, curr) => acc + curr.totalPrice, 0);

        return (
            <div className="p-4 pb-24 space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-saibro-900">Klanches</h2>
                    <div className="bg-orange-100 p-2 rounded-full text-saibro-600">
                        <ShoppingCart size={24} />
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-lg border-2 border-saibro-100 p-6 flex flex-col items-center">
                    <span className="text-stone-500 font-medium">Saldo em Aberto</span>
                    <span className={`text-4xl font-bold mt-2 ${totalDue > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        R$ {totalDue.toFixed(2)}
                    </span>
                    <div className="mt-4 px-3 py-1 bg-stone-100 rounded-full text-xs text-stone-500">
                        Status: {totalDue > 0 ? 'Pagamento Pendente' : 'Tudo Certo!'}
                    </div>
                </div>

                <div>
                    <h3 className="font-semibold text-stone-700 mb-3">Histórico de Consumo</h3>
                    <div className="space-y-3">
                        {myConsumptions.length === 0 ? (
                            <p className="text-stone-400 text-center py-4">Nenhum consumo em aberto.</p>
                        ) : (
                            myConsumptions.map(c => {
                                const product = products.find(p => p.id === c.productId);
                                return (
                                    <div key={c.id} className="bg-white p-4 rounded-xl flex justify-between items-center shadow-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-saibro-50 rounded-lg flex items-center justify-center text-saibro-600">
                                                {ICON_MAP[product?.icon || 'package']}
                                            </div>
                                            <div>
                                                <p className="font-medium text-stone-800">{product?.name || 'Produto'}</p>
                                                <p className="text-xs text-stone-400">{c.date} • {c.quantity}x</p>
                                            </div>
                                        </div>
                                        <span className="font-bold text-saibro-700">R$ {c.totalPrice.toFixed(2)}</span>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ========== ADMIN/LANCHONETE VIEW ==========

    // Cart functions
    const addToCart = (product: ExtendedProduct) => {
        if (!selectedUser) {
            alert('Selecione um cliente primeiro!');
            return;
        }
        const existing = cart.find(c => c.productId === product.id);
        if (existing) {
            setCart(cart.map(c => c.productId === product.id
                ? { ...c, quantity: c.quantity + 1 }
                : c
            ));
        } else {
            setCart([...cart, { productId: product.id, quantity: 1, price: product.price }]);
        }
    };

    const removeFromCart = (productId: string) => {
        setCart(cart.filter(c => c.productId !== productId));
    };

    const updateCartQuantity = (productId: string, delta: number) => {
        setCart(cart.map(c => {
            if (c.productId === productId) {
                const newQty = c.quantity + delta;
                return newQty > 0 ? { ...c, quantity: newQty } : c;
            }
            return c;
        }).filter(c => c.quantity > 0));
    };

    const cartTotal = cart.reduce((acc, c) => acc + (c.price * c.quantity), 0);

    const handleSaveCart = async () => {
        if (!selectedUser || cart.length === 0) return;

        setSaving(true);

        for (const item of cart) {
            await supabase.from('consumptions').insert({
                user_id: selectedUser,
                product_id: item.productId,
                quantity: item.quantity,
                total_price: item.price * item.quantity,
                date: getNowInFortaleza().toISOString(),
                status: 'open'
            });
        }

        // Refresh consumptions
        const { data: consumptionsData } = await supabase
            .from('consumptions')
            .select('*')
            .order('date', { ascending: false });

        setConsumptions((consumptionsData || []).map(c => ({
            id: c.id,
            userId: c.user_id,
            productId: c.product_id,
            quantity: c.quantity,
            totalPrice: Number(c.total_price),
            date: typeof c.date === 'string' ? c.date.split('T')[0] : getNowInFortaleza().toISOString().split('T')[0],
            status: c.status
        })));

        setCart([]);
        setSaving(false);
        alert('Consumo salvo com sucesso!');
    };

    const handleLiquidateAccount = async (userId: string) => {
        if (!confirm('Confirma o recebimento do pagamento?')) return;

        await supabase
            .from('consumptions')
            .update({ status: 'paid' })
            .eq('user_id', userId)
            .eq('status', 'open');

        setConsumptions(consumptions.map(c =>
            c.userId === userId && c.status === 'open'
                ? { ...c, status: 'paid' }
                : c
        ));
    };

    const handleSaveProduct = async () => {
        try {
            if (!productForm.name || !productForm.price) {
                alert('Preencha nome e preço!');
                return;
            }

            const productData = {
                name: productForm.name,
                price: parseFloat(productForm.price.replace(',', '.')), // Handle comma as decimal separator
                image_url: productForm.imageUrl || null,
                icon: productForm.icon,
                is_active: true
                // stock_quantity removed as requested
            };

            const { error, data } = editingProduct
                ? await supabase.from('products').update(productData).eq('id', editingProduct.id).select().single()
                : await supabase.from('products').insert(productData).select().single();

            if (error) throw error;

            if (editingProduct) {
                setProducts(products.map(p => p.id === editingProduct.id
                    ? { ...p, ...productData, imageUrl: productData.image_url, stockQuantity: 0 }
                    : p
                ));
            } else if (data) {
                setProducts([...products, {
                    id: data.id,
                    name: data.name,
                    price: Number(data.price),
                    active: data.is_active,
                    imageUrl: data.image_url,
                    icon: data.icon,
                    stockQuantity: 0
                }]);
            }

            setShowAddProduct(false);
            setEditingProduct(null);
            setProductForm({ name: '', price: '', imageUrl: '', icon: 'package' });
        } catch (error: any) {
            console.error('Error saving product:', error);
            alert(`Erro ao salvar produto: ${error.message}`);
        }
    };

    const handleDeleteProduct = async (productId: string) => {
        if (!confirm('Excluir este produto?')) return;

        await supabase.from('products').update({ is_active: false }).eq('id', productId);
        setProducts(products.filter(p => p.id !== productId));
    };

    const openEditProduct = (product: ExtendedProduct) => {
        setEditingProduct(product);
        setProductForm({
            name: product.name,
            price: product.price.toString(),
            imageUrl: product.imageUrl || '',
            icon: product.icon || 'package'
        });
        setShowAddProduct(true);
    };

    // Debtors data
    const debtors = profiles.filter(p => {
        const userConsumptions = consumptions.filter(c => c.userId === p.id && c.status === 'open');
        return userConsumptions.length > 0;
    }).map(p => {
        const userConsumptions = consumptions.filter(c => c.userId === p.id && c.status === 'open');
        return {
            ...p,
            total: userConsumptions.reduce((acc, c) => acc + c.totalPrice, 0),
            consumptions: userConsumptions
        };
    });

    const totalDebt = debtors.reduce((acc, d) => acc + d.total, 0);

    return (
        <div className="p-4 pb-24 space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-saibro-900">Klanches Admin</h2>
                <button
                    onClick={() => { setEditingProduct(null); setProductForm({ name: '', price: '', imageUrl: '', icon: 'package' }); setShowAddProduct(true); }}
                    className="p-2 bg-saibro-500 text-white rounded-full hover:bg-saibro-600 transition-colors"
                >
                    <Plus size={20} />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 bg-stone-100 p-1 rounded-xl">
                <button
                    onClick={() => setActiveTab('produtos')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'produtos' ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500'}`}
                >
                    <Package size={16} /> Produtos
                </button>
                <button
                    onClick={() => setActiveTab('devedores')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'devedores' ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500'}`}
                >
                    <Users size={16} /> Devedores
                    {debtors.length > 0 && (
                        <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{debtors.length}</span>
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('no_clube')}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'no_clube' ? 'bg-white text-saibro-700 shadow-sm' : 'text-stone-500'}`}
                >
                    <Calendar size={16} /> No Clube
                </button>
            </div>

            {/* ====== PRODUTOS TAB ====== */}
            {activeTab === 'produtos' && (
                <div className="space-y-4">
                    {/* User Selection */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-100">
                        <label className="block text-xs font-bold text-stone-500 uppercase mb-2">Cliente</label>
                        <select
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-saibro-300"
                            value={selectedUser}
                            onChange={(e) => { setSelectedUser(e.target.value); setCart([]); }}
                        >
                            <option value="">Selecione o Cliente</option>
                            {profiles.filter(u => u.role !== 'lanchonete').map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Product Grid */}
                    <div className="grid grid-cols-2 gap-3">
                        {products.map(p => {
                            const inCart = cart.find(c => c.productId === p.id);
                            return (
                                <div key={p.id} className="bg-white rounded-2xl card-court overflow-hidden group relative">
                                    {/* Edit/Delete buttons */}
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <button onClick={() => openEditProduct(p)} className="p-1.5 bg-white/90 rounded-lg text-stone-500 hover:text-saibro-600">
                                            <Edit size={14} />
                                        </button>
                                        <button onClick={() => handleDeleteProduct(p.id)} className="p-1.5 bg-white/90 rounded-lg text-stone-500 hover:text-red-500">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>

                                    {/* Product Image/Icon */}
                                    <div className="h-20 bg-linear-to-br from-saibro-50 to-orange-50 flex items-center justify-center">
                                        {p.imageUrl ? (
                                            <img src={p.imageUrl} alt={p.name} className="h-16 w-16 object-contain" />
                                        ) : (
                                            <div className="text-saibro-400">
                                                {ICON_MAP[p.icon || 'package']}
                                            </div>
                                        )}
                                    </div>

                                    {/* Product Info */}
                                    <div className="p-3">
                                        <h4 className="font-semibold text-stone-800 text-sm truncate">{p.name}</h4>
                                        <div className="flex items-center justify-between mt-1">
                                            <span className="text-saibro-600 font-bold">R$ {p.price.toFixed(2)}</span>
                                            {inCart ? (
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => updateCartQuantity(p.id, -1)} className="w-6 h-6 bg-stone-100 rounded text-stone-600 font-bold">-</button>
                                                    <span className="w-6 text-center text-sm font-bold">{inCart.quantity}</span>
                                                    <button onClick={() => updateCartQuantity(p.id, 1)} className="w-6 h-6 bg-saibro-500 rounded text-white font-bold">+</button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => addToCart(p)}
                                                    disabled={!selectedUser}
                                                    className="p-1.5 bg-saibro-500 text-white rounded-lg disabled:opacity-40"
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Cart Summary */}
                    {cart.length > 0 && (
                        <div className="bg-white rounded-2xl card-court ring-2 ring-saibro-300 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-stone-800">Carrinho</span>
                                <span className="text-lg font-bold text-saibro-600">R$ {cartTotal.toFixed(2)}</span>
                            </div>
                            <div className="text-sm text-stone-500 space-y-1">
                                {cart.map(c => {
                                    const p = products.find(prod => prod.id === c.productId);
                                    return (
                                        <div key={c.productId} className="flex justify-between">
                                            <span>{c.quantity}x {p?.name}</span>
                                            <span>R$ {(c.price * c.quantity).toFixed(2)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <button
                                onClick={handleSaveCart}
                                disabled={saving}
                                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
                            >
                                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                Salvar Consumo
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ====== DEVEDORES TAB ====== */}
            {activeTab === 'devedores' && (
                <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                            <p className="text-xs text-stone-500 uppercase font-semibold">Total em Aberto</p>
                            <p className="text-2xl font-bold text-red-500">R$ {totalDebt.toFixed(2)}</p>
                        </div>
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100">
                            <p className="text-xs text-stone-500 uppercase font-semibold">Sócios Devendo</p>
                            <p className="text-2xl font-bold text-saibro-600">{debtors.length}</p>
                        </div>
                    </div>

                    {/* Debtors List */}
                    <div className="space-y-3">
                        {debtors.length === 0 ? (
                            <div className="text-center py-8 text-stone-400">
                                <CheckCircle size={40} className="mx-auto mb-2 text-green-400" />
                                Nenhuma conta em aberto!
                            </div>
                        ) : (
                            debtors.map(debtor => (
                                <div key={debtor.id} className="bg-white rounded-2xl card-court overflow-hidden">
                                    <button
                                        onClick={() => setExpandedDebtor(expandedDebtor === debtor.id ? null : debtor.id)}
                                        className="w-full p-4 flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-3">
                                            <img src={debtor.avatar || 'https://via.placeholder.com/40'} alt="" className="w-10 h-10 rounded-full bg-stone-200" />
                                            <div className="text-left">
                                                <p className="font-semibold text-stone-800">{debtor.name}</p>
                                                <p className="text-xs text-stone-400">{debtor.consumptions.length} itens</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg font-bold text-red-500">R$ {debtor.total.toFixed(2)}</span>
                                            {expandedDebtor === debtor.id ? <ChevronUp size={20} className="text-stone-400" /> : <ChevronDown size={20} className="text-stone-400" />}
                                        </div>
                                    </button>

                                    {expandedDebtor === debtor.id && (
                                        <div className="border-t border-stone-100 p-4 bg-stone-50 space-y-3">
                                            {debtor.consumptions.map(c => {
                                                const product = products.find(p => p.id === c.productId);
                                                return (
                                                    <div key={c.id} className="flex items-center justify-between text-sm">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-saibro-500">
                                                                {ICON_MAP[product?.icon || 'package']}
                                                            </div>
                                                            <div>
                                                                <span className="text-stone-700">{product?.name}</span>
                                                                <span className="text-xs text-stone-400 ml-2">{c.quantity}x • {c.date}</span>
                                                            </div>
                                                        </div>
                                                        <span className="font-medium text-stone-700">R$ {c.totalPrice.toFixed(2)}</span>
                                                    </div>
                                                );
                                            })}
                                            <button
                                                onClick={() => handleLiquidateAccount(debtor.id)}
                                                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 mt-2"
                                            >
                                                <CheckCircle size={18} /> Liquidar Conta
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ====== NO CLUBE TAB ====== */}
            {activeTab === 'no_clube' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-stone-100 flex justify-between items-center">
                        <div>
                            <p className="text-xs text-stone-500 uppercase font-semibold">Agendamentos Hoje</p>
                            <p className="text-2xl font-bold text-saibro-600">{reservations.length}</p>
                        </div>
                        <div className="text-stone-300">
                            <Calendar size={32} />
                        </div>
                    </div>

                    <div className="space-y-3">
                        {reservations.length === 0 ? (
                            <div className="text-center py-12 text-stone-400 bg-white rounded-2xl border-2 border-dashed border-stone-100">
                                <AlertCircle size={40} className="mx-auto mb-2 text-stone-200" />
                                <p>Nenhum agendamento para hoje.</p>
                            </div>
                        ) : (
                            reservations
                                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                                .map(res => {
                                    const court = courts.find(c => c.id === res.courtId);
                                    const resParticipants = res.participantIds.map(id => profiles.find(p => p.id === id)).filter(Boolean);

                                    return (
                                        <div key={res.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
                                            <div className="p-4 bg-stone-50/50 border-b border-stone-100 flex justify-between items-center">
                                                <div className="flex items-center gap-2">
                                                    <Clock size={16} className="text-saibro-500" />
                                                    <span className="font-bold text-stone-700">{res.startTime} - {res.endTime}</span>
                                                </div>
                                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-500">
                                                    {res.type}
                                                </span>
                                            </div>

                                            <div className="p-4 space-y-3">
                                                <div className="flex items-center gap-2 text-sm text-stone-600">
                                                    <MapPin size={14} className="text-stone-400" />
                                                    <span className="font-medium">{court?.name || 'Quadra'}</span>
                                                    <span className="text-xs text-stone-400">({court?.type})</span>
                                                </div>

                                                <div className="flex flex-wrap gap-2">
                                                    {resParticipants.map(p => (
                                                        <div key={p?.id} className="flex items-center gap-2 bg-white border border-stone-200 pl-1 pr-3 py-1 rounded-full shadow-sm">
                                                            <img src={p?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p?.id}`} className="w-6 h-6 rounded-full" alt="" />
                                                            <span className="text-xs font-medium text-stone-700">{p?.name}</span>
                                                        </div>
                                                    ))}
                                                    {res.guestName && (
                                                        <div className="flex items-center gap-2 bg-saibro-50 border border-saibro-100 pl-2 pr-3 py-1 rounded-full shadow-sm">
                                                            <div className="w-5 h-5 rounded-full bg-saibro-200 flex items-center justify-center text-[8px] font-bold text-saibro-700">G</div>
                                                            <span className="text-xs font-bold text-saibro-700">{res.guestName}</span>
                                                            <span className="text-[9px] text-saibro-400">(Convidado)</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {res.guestName && res.guestResponsibleId && (
                                                    <p className="text-[10px] text-stone-400 italic">
                                                        Responsável: {profiles.find(p => p.id === res.guestResponsibleId)?.name || 'N/A'}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                        )}
                    </div>
                </div>
            )}

            {/* ====== ADD/EDIT PRODUCT MODAL ====== */}
            {showAddProduct && (
                <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 animate-in zoom-in duration-200">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-saibro-800">
                                {editingProduct ? 'Editar Produto' : 'Novo Produto'}
                            </h3>
                            <button onClick={() => { setShowAddProduct(false); setEditingProduct(null); }} className="p-2 text-stone-400 hover:text-stone-600">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={productForm.name}
                                    onChange={e => setProductForm({ ...productForm, name: e.target.value })}
                                    className="w-full p-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-300 outline-none"
                                    placeholder="Ex: Água Mineral"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Preço (R$)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={productForm.price}
                                    onChange={e => setProductForm({ ...productForm, price: e.target.value })}
                                    className="w-full p-3 border border-stone-200 rounded-xl focus:ring-2 focus:ring-saibro-300 outline-none"
                                    placeholder="5.00"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Imagem do Produto</label>
                                <div className="space-y-2">
                                    {productForm.imageUrl && (
                                        <div className="relative w-full h-32 bg-stone-100 rounded-xl overflow-hidden mb-2 border border-stone-200">
                                            <img src={productForm.imageUrl} alt="Preview" className="w-full h-full object-contain" />
                                            <button
                                                onClick={() => setProductForm({ ...productForm, imageUrl: '' })}
                                                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full shadow-md hover:bg-red-600"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2">
                                        <label className="flex-1 cursor-pointer">
                                            <div className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-saibro-400 hover:text-saibro-600 transition-colors bg-stone-50">
                                                {uploadingImage ? (
                                                    <Loader2 className="animate-spin" size={20} />
                                                ) : (
                                                    <Image size={20} />
                                                )}
                                                <span className="text-sm font-medium">
                                                    {uploadingImage ? 'Enviando...' : 'Carregar Imagem'}
                                                </span>
                                            </div>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                                className="hidden"
                                                disabled={uploadingImage}
                                            />
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-stone-400">Formatos: JPG, PNG, WEBP. Salvo em 'klancheimages'.</p>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-stone-500 uppercase mb-1">Ícone</label>
                                <div className="flex gap-2">
                                    {Object.keys(ICON_MAP).map(icon => (
                                        <button
                                            key={icon}
                                            onClick={() => setProductForm({ ...productForm, icon })}
                                            className={`p-3 rounded-xl border-2 transition-all ${productForm.icon === icon ? 'border-saibro-500 bg-saibro-50 text-saibro-600' : 'border-stone-200 text-stone-400'}`}
                                        >
                                            {ICON_MAP[icon]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-stone-100">
                            <button
                                onClick={() => { setShowAddProduct(false); setEditingProduct(null); }}
                                className="flex-1 py-3 text-stone-500 font-bold hover:bg-stone-50 rounded-xl"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveProduct}
                                className="flex-1 py-3 bg-saibro-600 text-white rounded-xl font-bold shadow-md hover:bg-saibro-700"
                            >
                                Salvar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};